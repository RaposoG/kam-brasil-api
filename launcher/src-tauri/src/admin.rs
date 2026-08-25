//! Painel administrativo: a ponte com as rotas `/admin/*` e a leitura da pasta
//! de um mapa no disco.
//!
//! Mesma casca de `social.rs` e `ranked.rs` — o HTTP autenticado acontece deste
//! lado porque o token de sessão nunca pode chegar à webview.
//!
//! ponytail: um comando só (`admin_call`) para as dezesseis rotas do painel, em
//! vez de dezesseis cascas idênticas. O Rust aqui não decide nada sobre o
//! conteúdo — repassa JSON, como já faz `ApiClient::json_request`. Vira comando
//! por rota no dia em que alguma precisar de tratamento próprio deste lado.
//!
//! A trava daqui é de **escopo**, não de permissão: nada fora de `/admin/`
//! passa por este comando. Quem concede o acesso é o `requireAdmin` da API, que
//! confere `accounts.isAdmin` a cada requisição; o `isAdmin` que a conta traz
//! para a tela é só a chave do menu.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use reqwest::Method;
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::auth::{require_token, AppState};
use crate::replay::boundary_livre;

/// Teto do envio, espelhando o `LIMITE_UPLOAD_BYTES` de
/// `api/src/mapas/catalogo.ts`. Conferir deste lado não é redundância: a API
/// responde 413 sem corpo útil, e o admin merece saber que o problema é o
/// tamanho da pasta, não a rede.
const LIMITE_BYTES: u64 = 64 * 1024 * 1024;

/// Nome da parte de arquivo. Todos os arquivos da pasta vão com este nome, cada
/// um com o seu `filename` — é o `form.getAll("arquivos")` de
/// `api/src/routes/mapas.ts`.
const CAMPO_ARQUIVOS: &str = "arquivos";

/// O nome da pasta viaja como campo de texto: é o nome do mapa, e o outro lado
/// exige o par `<nome>.dat` + `<nome>.map` dentro do envio.
const CAMPO_NOME: &str = "nome";

/// Rota do envio da pasta do mapa. Padrão daqui, trocável pela tela sem
/// recompilar o Rust — ver `src/admin.ts`.
const ROTA_UPLOAD: &str = "/admin/maps/upload";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArquivoDoMapa {
    /// Só o nome do arquivo. A API recusa `/` no `filename`, então subpasta não
    /// sobe — ver `varrer`.
    pub caminho: String,
    pub bytes: u64,
}

/// O que o launcher consegue afirmar sobre uma pasta de mapa **sem** perguntar
/// nada ao admin.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PastaDeMapa {
    /// O nome do mapa é o nome da pasta — é assim que o jogo o procura.
    pub nome: String,
    pub pasta: String,
    /// Hex de 8 dígitos, maiúsculo. `None` = a pasta não tem `.mi` e o CRC vai
    /// ter que ser digitado (com todo o risco que isso traz).
    pub crc: Option<String>,
    pub arquivos: Vec<ArquivoDoMapa>,
    pub total_bytes: u64,
}

/// O CRC de rede do mapa, lido do cache `.mi` que o jogo escreve na pasta.
///
/// São os **primeiros 4 bytes**, um `Cardinal` little-endian:
/// `TKMMapInfo.SaveToFile` grava `fCRC` antes de tudo (`KM_Maps.pas:775`), e é
/// exatamente `fCRC` que o cliente difunde em `mkMapSelect`
/// (`KM_Networking.pas:543`) e que o servidor dedicado compara com o CRC da
/// reserva (`KM_NetServer.pas:1138`). Os 4 bytes seguintes são `fDatCRC` e os
/// outros 4 o `fMapAndDatCRC` — nenhum dos dois serve para casar sala.
///
/// Ler isto em vez de pedir ao admin que digite não é conforto: CRC errado no
/// catálogo faz o servidor mandar `mkMapSelect` com um número que o cliente
/// recusa, e o jogador cai num download que nunca termina.
pub fn crc_do_mi(bytes: &[u8]) -> Option<String> {
    let cabeca: [u8; 4] = bytes.get(..4)?.try_into().ok()?;
    Some(format!("{:08X}", u32::from_le_bytes(cabeca)))
}

/// Lista os arquivos soltos da pasta.
///
/// Subpasta é **erro**, não conteúdo a ignorar: o `filename` do multipart não
/// carrega caminho (a API recusa `/`), então pular em silêncio subiria um mapa
/// faltando arquivo — e a falha só apareceria no jogador que entra na sala e
/// não consegue carregar. Isso deixa de fora os dois mapas do acervo que usam
/// `Scripts/`; é o teto conhecido, e ele avisa em vez de mentir.
fn varrer(dir: &Path, out: &mut Vec<ArquivoDoMapa>) -> Result<(), String> {
    let entradas =
        std::fs::read_dir(dir).map_err(|e| format!("não foi possível ler {}: {e}", dir.display()))?;

    for entrada in entradas.flatten() {
        let caminho = entrada.path();
        let Some(nome) = caminho.file_name().and_then(|s| s.to_str()) else {
            continue;
        };

        if caminho.is_dir() {
            return Err(format!(
                "o envio não suporta subpasta dentro da pasta do mapa (achei \"{nome}\")"
            ));
        }

        out.push(ArquivoDoMapa {
            caminho: nome.to_string(),
            bytes: entrada.metadata().map(|m| m.len()).unwrap_or(0),
        });
    }

    Ok(())
}

/// Descreve a pasta sem ler o conteúdo dos arquivos — é o que a tela mostra
/// antes de o admin confirmar o envio.
pub fn ler_pasta_de_mapa(pasta: &Path) -> Result<PastaDeMapa, String> {
    let nome = pasta
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| format!("pasta inválida: {}", pasta.display()))?
        .to_string();

    let mut arquivos: Vec<ArquivoDoMapa> = Vec::new();
    varrer(pasta, &mut arquivos)?;
    arquivos.sort_by(|a, b| a.caminho.to_lowercase().cmp(&b.caminho.to_lowercase()));

    let tem = |ext: &str| {
        let alvo = format!("{nome}.{ext}");
        arquivos.iter().any(|a| a.caminho.eq_ignore_ascii_case(&alvo))
    };
    // O par `.dat` + `.map` é o que o jogo exige para o mapa existir. Sem ele
    // não adianta subir nada: a sala abriria e ninguém conseguiria carregar.
    if !tem("dat") || !tem("map") {
        return Err(format!(
            "{nome}: isto não parece uma pasta de mapa — falta {nome}.dat ou {nome}.map"
        ));
    }

    let crc = std::fs::read(pasta.join(format!("{nome}.mi")))
        .ok()
        .as_deref()
        .and_then(crc_do_mi);

    let total_bytes = arquivos.iter().map(|a| a.bytes).sum();

    Ok(PastaDeMapa {
        nome,
        pasta: pasta.display().to_string(),
        crc,
        arquivos,
        total_bytes,
    })
}

/// Aspas e quebras de linha no nome do arquivo quebrariam o cabeçalho da parte
/// — e um `filename` cortado no meio vira envio corrompido do outro lado.
fn nome_de_arquivo_seguro(nome: &str) -> Result<(), String> {
    if nome.contains(['"', '\\', '/']) || nome.chars().any(|c| c.is_control()) {
        return Err(format!("nome de arquivo não aceito no envio: {nome:?}"));
    }
    Ok(())
}

/// Monta o corpo `multipart/form-data` com campos de texto **e** arquivos.
///
/// A diferença para o de `replay.rs` é o `filename`: uma parte sem ele chega ao
/// outro lado como string (`form.get("modos")`), e com ele chega como arquivo
/// (`form.getAll("arquivos")`). Lá todas as partes são arquivo; aqui os campos
/// precisam continuar texto, senão `modos` viraria um arquivo chamado "modos".
pub fn corpo_multipart(
    boundary: &str,
    campos: &BTreeMap<String, String>,
    arquivos: &[(String, Vec<u8>)],
) -> Vec<u8> {
    let mut corpo = Vec::new();

    for (nome, valor) in campos {
        corpo.extend_from_slice(
            format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{nome}\"\r\n\r\n{valor}\r\n")
                .as_bytes(),
        );
    }

    for (arquivo, bytes) in arquivos {
        corpo.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"{CAMPO_ARQUIVOS}\"; \
                 filename=\"{arquivo}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
            )
            .as_bytes(),
        );
        corpo.extend_from_slice(bytes);
        corpo.extend_from_slice(b"\r\n");
    }
    corpo.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

    corpo
}

/// Lê a pasta inteira para a memória.
///
/// O `.mi` vai junto de propósito: é dele que a API tira o CRC. Distribuí-lo
/// aos jogadores é outra decisão, e é do outro lado — ele fica fora do
/// manifesto porque carrega a revisão do jogo que o gerou.
fn ler_arquivos(pasta: &Path, info: &PastaDeMapa) -> Result<Vec<(String, Vec<u8>)>, String> {
    if info.total_bytes > LIMITE_BYTES {
        return Err(format!(
            "a pasta tem {} bytes e o limite do envio é {LIMITE_BYTES}",
            info.total_bytes
        ));
    }

    let mut lidos = Vec::with_capacity(info.arquivos.len());
    for arquivo in &info.arquivos {
        nome_de_arquivo_seguro(&arquivo.caminho)?;
        let caminho = pasta.join(&arquivo.caminho);
        let bytes = std::fs::read(&caminho)
            .map_err(|e| format!("não foi possível ler {}: {e}", caminho.display()))?;
        lidos.push((arquivo.caminho.clone(), bytes));
    }

    Ok(lidos)
}

/// Só rotas do painel saem por aqui. A webview é código nosso, mas um comando
/// que aceitasse qualquer caminho seria um "faça um request autenticado com o
/// token que você não pode ver" — e aí o cuidado de manter o token no Rust
/// perderia o sentido.
fn rota_do_painel(rota: &str) -> Result<(), String> {
    if !rota.starts_with("/admin/") || rota.contains("..") {
        return Err(format!("rota fora do painel administrativo: {rota}"));
    }
    Ok(())
}

fn metodo(verbo: &str) -> Result<Method, String> {
    match verbo.to_ascii_uppercase().as_str() {
        "GET" => Ok(Method::GET),
        "POST" => Ok(Method::POST),
        "PUT" => Ok(Method::PUT),
        "DELETE" => Ok(Method::DELETE),
        outro => Err(format!("método não usado pelo painel: {outro}")),
    }
}

#[tauri::command]
pub async fn admin_call(
    state: State<'_, AppState>,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Value, String> {
    rota_do_painel(&path)?;
    let verbo = metodo(&method)?;
    let token = require_token(&state)?;
    state.api().json_request(&token, verbo, &path, body).await
}

#[tauri::command]
pub fn admin_map_folder(pasta: String) -> Result<PastaDeMapa, String> {
    ler_pasta_de_mapa(&PathBuf::from(pasta))
}

/// Sobe a pasta inteira do mapa para o painel.
///
/// Separada do comando para poder ser exercitada com uma pasta qualquer.
pub async fn subir_mapa(
    base: &str,
    token: &str,
    pasta: &Path,
    rota: &str,
    campos: &BTreeMap<String, String>,
) -> Result<Value, String> {
    rota_do_painel(rota)?;

    let info = ler_pasta_de_mapa(pasta)?;
    let arquivos = ler_arquivos(pasta, &info)?;

    // O nome vai daqui e não da tela: é o nome da PASTA, e é por ele que o jogo
    // procura o mapa. Deixar a interface digitá-lo abriria espaço para uma
    // divergência que só apareceria na hora de carregar a partida.
    let mut corpo_campos = campos.clone();
    corpo_campos.insert(CAMPO_NOME.to_string(), info.nome.clone());

    let conteudos: Vec<&[u8]> = arquivos.iter().map(|(_, bytes)| bytes.as_slice()).collect();
    let boundary = boundary_livre(&conteudos);
    let corpo = corpo_multipart(&boundary, &corpo_campos, &arquivos);

    // Cliente próprio pelo mesmo motivo de `replay.rs`: é um upload esporádico,
    // e o alternativo seria abrir `auth.rs` só para um método usado num lugar.
    let resposta = reqwest::Client::new()
        .post(format!("{}{rota}", base.trim_end_matches('/')))
        .bearer_auth(token)
        .header(
            "content-type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(corpo)
        .send()
        .await
        .map_err(|e| format!("não foi possível falar com o servidor: {e}"))?;

    let status = resposta.status();
    let texto = resposta
        .text()
        .await
        .map_err(|e| format!("resposta inesperada do servidor: {e}"))?;

    let json: Value = serde_json::from_str(&texto).unwrap_or(Value::Null);

    if !status.is_success() {
        return Err(json
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("erro inesperado do servidor ({status})")));
    }

    Ok(json)
}

#[tauri::command]
pub async fn admin_map_upload(
    state: State<'_, AppState>,
    pasta: String,
    campos: BTreeMap<String, String>,
    rota: Option<String>,
) -> Result<Value, String> {
    let token = require_token(&state)?;
    subir_mapa(
        &state.api_base(),
        &token,
        &PathBuf::from(pasta),
        rota.as_deref().unwrap_or(ROTA_UPLOAD),
        &campos,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc_sai_dos_quatro_primeiros_bytes_em_little_endian() {
        // Cabeçalho real de um `.mi` gerado pelo jogo (A Clash of Kings):
        // 74 96 05 80 = fCRC, e o que vem depois é fDatCRC e fMapAndDatCRC.
        let mi = [
            0x74, 0x96, 0x05, 0x80, 0xc7, 0x4c, 0xaa, 0xdd, 0xc8, 0x6d, 0x2b, 0xef,
        ];
        assert_eq!(crc_do_mi(&mi).as_deref(), Some("80059674"));

        // `.mi` truncado não vira CRC zero: vira "não sei", e a tela pede o
        // número ao admin em vez de cadastrar um mapa que ninguém carrega.
        assert_eq!(crc_do_mi(&[0x74, 0x96]), None);
        assert_eq!(crc_do_mi(&[]), None);
    }

    #[test]
    fn pasta_sem_o_par_dat_e_map_nao_e_mapa() {
        let raiz = std::env::temp_dir().join("kambrasil-admin-mapa");
        let pasta = raiz.join("Ilha do Sul");
        let _ = std::fs::remove_dir_all(&raiz);
        std::fs::create_dir_all(&pasta).unwrap();

        std::fs::write(pasta.join("Ilha do Sul.dat"), b"dat").unwrap();
        assert!(ler_pasta_de_mapa(&pasta).is_err(), "só o .dat não é mapa");

        std::fs::write(pasta.join("Ilha do Sul.map"), b"mapa").unwrap();
        std::fs::write(pasta.join("Ilha do Sul.txt"), b"descricao").unwrap();

        let info = ler_pasta_de_mapa(&pasta).unwrap();
        assert_eq!(info.nome, "Ilha do Sul");
        assert_eq!(info.crc, None, "sem .mi não há CRC para afirmar");
        assert_eq!(info.arquivos.len(), 3);
        assert_eq!(info.total_bytes, 3 + 4 + 9);

        // Com o cache do jogo na pasta, o CRC deixa de ser digitado.
        std::fs::write(pasta.join("Ilha do Sul.mi"), [0x74, 0x96, 0x05, 0x80, 0x00]).unwrap();
        assert_eq!(ler_pasta_de_mapa(&pasta).unwrap().crc.as_deref(), Some("80059674"));

        // Subpasta não sobe: o `filename` do multipart não carrega caminho.
        // Falhar alto é melhor que subir o mapa sem os arquivos de dentro dela.
        std::fs::create_dir_all(pasta.join("Scripts")).unwrap();
        assert!(ler_pasta_de_mapa(&pasta).is_err(), "subpasta tem que avisar");

        let _ = std::fs::remove_dir_all(&raiz);
    }

    /// O formato é contrato com `api/src/routes/mapas.ts`: campo de texto sem
    /// `filename` vira string em `form.get`, e arquivo com `filename` vira File
    /// em `form.getAll("arquivos")`. Trocar um pelo outro faz o upload virar 400
    /// sem ninguém entender por quê.
    #[test]
    fn campo_de_texto_vai_sem_filename_e_arquivo_vai_com() {
        let mut campos = BTreeMap::new();
        campos.insert("modos".to_string(), "[\"1v1\"]".to_string());
        let arquivos = vec![("Ilha.map".to_string(), vec![1u8, 2])];

        let corpo = corpo_multipart("XYZ", &campos, &arquivos);
        let esperado = [
            b"--XYZ\r\nContent-Disposition: form-data; name=\"modos\"\r\n\r\n[\"1v1\"]\r\n".to_vec(),
            b"--XYZ\r\nContent-Disposition: form-data; name=\"arquivos\"; filename=\"Ilha.map\"\r\nContent-Type: application/octet-stream\r\n\r\n".to_vec(),
            vec![1, 2],
            b"\r\n--XYZ--\r\n".to_vec(),
        ]
        .concat();

        assert_eq!(corpo, esperado);
    }

    #[test]
    fn o_comando_so_alcanca_o_painel() {
        assert!(rota_do_painel("/admin/maps").is_ok());
        assert!(rota_do_painel("/auth/ticket").is_err());
        assert!(rota_do_painel("/admin/../auth/ticket").is_err());
        assert!(rota_do_painel("/adminfalso").is_err());

        assert!(metodo("get").is_ok());
        assert!(metodo("PATCH").is_err());
    }

    #[test]
    fn nome_de_arquivo_com_aspas_nao_sobe() {
        assert!(nome_de_arquivo_seguro("Ilha do Sul.map").is_ok());
        assert!(nome_de_arquivo_seguro("Ilha \"do\" Sul.map").is_err());
        assert!(nome_de_arquivo_seguro("..\\..\\Windows\\system.ini").is_err());
        assert!(nome_de_arquivo_seguro("quebra\nlinha.map").is_err());
    }
}
