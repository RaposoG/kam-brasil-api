//! Conversão das vozes das unidades para o formato que o jogo aceita.
//!
//! O Knights and Merchants original guarda as falas em `.snd`, que apesar do
//! nome é **áudio MPEG-1 Layer II** — o mesmo MP2 das músicas. O KaM Remake, por
//! outro lado, só procura `.wav`:
//!
//! ```pascal
//! //All our files are WAV now. Don't accept SND files because TPR uses SND in a
//! //different format which can cause OpenAL to crash
//! Result := S + '.wav';
//! ```
//!
//! Não dá para simplesmente renomear, e não dá para ensinar o jogo a ler `.snd`:
//! é justamente esse formato que derruba o OpenAL, e foi por isso que o upstream
//! passou a exigir WAV. Então decodificamos aqui, uma vez, na instalação.
//!
//! São 447 arquivos somando 10 MB — segundos de trabalho.

use std::io::Write;
use std::path::Path;
use symphonia::core::audio::{AudioSpec, GenericAudioBufferRef};
use symphonia::core::codecs::audio::{AudioDecoder, AudioDecoderOptions};
use symphonia::core::formats::{FormatOptions, FormatReader, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::default::codecs::MpaDecoder;
use symphonia::default::formats::MpaReader;

/// Decodifica um `.snd` (MP2) e grava o `.wav` equivalente ao lado.
///
/// Usa MpaReader/MpaDecoder direto em vez do detector genérico: sabemos
/// exatamente o formato, e a extensão `.snd` não ajudaria o detector mesmo.
fn converter(origem: &Path, destino: &Path) -> Result<(), String> {
    let arquivo = std::fs::File::open(origem).map_err(|e| format!("{}: {e}", origem.display()))?;
    let fluxo = MediaSourceStream::new(Box::new(arquivo), Default::default());

    let mut leitor = MpaReader::try_new(fluxo, FormatOptions::default())
        .map_err(|e| format!("{} não é MPEG audio: {e}", origem.display()))?;

    let faixa = leitor
        .default_track(TrackType::Audio)
        .ok_or_else(|| format!("{} não tem faixa de áudio", origem.display()))?;
    let faixa_id = faixa.id;

    let params = match faixa.codec_params.as_ref() {
        Some(symphonia::core::codecs::CodecParameters::Audio(a)) => a.clone(),
        _ => return Err(format!("{} sem parâmetros de áudio", origem.display())),
    };

    let mut decodificador = MpaDecoder::try_new(&params, &AudioDecoderOptions::default())
        .map_err(|e| format!("sem decodificador para {}: {e}", origem.display()))?;

    let mut amostras: Vec<i16> = Vec::new();
    let mut spec: Option<AudioSpec> = None;

    while let Ok(Some(pacote)) = leitor.next_packet() {
        if pacote.track_id != faixa_id {
            continue;
        }
        match decodificador.decode(&pacote) {
            Ok(audio) => {
                spec = Some(audio.spec().clone());
                acrescentar(&audio, &mut amostras);
            }
            // Quadro corrompido no meio não deve perder o arquivo inteiro.
            Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
            Err(e) => return Err(format!("erro ao decodificar {}: {e}", origem.display())),
        }
    }

    let Some(spec) = spec else {
        return Err(format!("{} não produziu áudio", origem.display()));
    };
    if amostras.is_empty() {
        return Err(format!("{} decodificou vazio", origem.display()));
    }

    escrever_wav(destino, &amostras, spec.channels().count() as u16, spec.rate())
}

fn acrescentar(audio: &GenericAudioBufferRef<'_>, destino: &mut Vec<i16>) {
    let inicio = destino.len();
    destino.resize(inicio + audio.samples_interleaved(), 0);
    audio.copy_to_slice_interleaved(&mut destino[inicio..]);
}

/// Escreve um WAV PCM 16 bits.
///
/// Feito à mão em vez de uma dependência: são 44 bytes de cabeçalho com campos
/// fixos, e o formato não muda desde 1991.
fn escrever_wav(destino: &Path, amostras: &[i16], canais: u16, taxa: u32) -> Result<(), String> {
    let bits = 16u16;
    let bytes_dados = (amostras.len() * 2) as u32;
    let byte_rate = taxa * canais as u32 * (bits / 8) as u32;
    let block_align = canais * (bits / 8);

    let mut saida = Vec::with_capacity(44 + amostras.len() * 2);
    saida.extend_from_slice(b"RIFF");
    saida.extend_from_slice(&(36 + bytes_dados).to_le_bytes());
    saida.extend_from_slice(b"WAVEfmt ");
    saida.extend_from_slice(&16u32.to_le_bytes()); // tamanho do bloco fmt
    saida.extend_from_slice(&1u16.to_le_bytes()); // PCM sem compressão
    saida.extend_from_slice(&canais.to_le_bytes());
    saida.extend_from_slice(&taxa.to_le_bytes());
    saida.extend_from_slice(&byte_rate.to_le_bytes());
    saida.extend_from_slice(&block_align.to_le_bytes());
    saida.extend_from_slice(&bits.to_le_bytes());
    saida.extend_from_slice(b"data");
    saida.extend_from_slice(&bytes_dados.to_le_bytes());
    for a in amostras {
        saida.extend_from_slice(&a.to_le_bytes());
    }

    let mut f = std::fs::File::create(destino).map_err(|e| format!("{}: {e}", destino.display()))?;
    f.write_all(&saida).map_err(|e| format!("{}: {e}", destino.display()))?;
    Ok(())
}

/// Converte todos os `.snd` sob `pasta` que ainda não tenham `.wav` ao lado.
///
/// Devolve quantos converteu. Um arquivo que falha não interrompe os outros: uma
/// voz faltando é melhor que a instalação inteira parar.
pub fn converter_falas(pasta: &Path, mut progresso: impl FnMut(usize, usize)) -> usize {
    let pendentes: Vec<_> = arquivos_snd(pasta)
        .into_iter()
        .filter(|p| !p.with_extension("wav").exists())
        .collect();

    let total = pendentes.len();
    let mut feitos = 0;

    for (i, snd) in pendentes.iter().enumerate() {
        if converter(snd, &snd.with_extension("wav")).is_ok() {
            feitos += 1;
        }
        if i % 25 == 0 {
            progresso(i, total);
        }
    }

    feitos
}

fn arquivos_snd(pasta: &Path) -> Vec<std::path::PathBuf> {
    let mut achados = Vec::new();
    let Ok(entradas) = std::fs::read_dir(pasta) else { return achados };

    for e in entradas.flatten() {
        let p = e.path();
        if p.is_dir() {
            achados.extend(arquivos_snd(&p));
        } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("snd")) {
            achados.push(p);
        }
    }
    achados
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Converte um .snd real do jogo e confere que sai WAV que o jogo aceita.
    /// Sem isso, so saberiamos que compila -- nao que decodifica.
    #[test]
    fn converte_snd_real_do_jogo_em_wav() {
        let origem = std::env::var("LOCALAPPDATA")
            .map(|d| PathBuf::from(d).join("KamBrasil/game/data/sfx/speech/AXEMAN/ATTACK0.snd"))
            .unwrap_or_default();
        if !origem.is_file() {
            eprintln!("pulando: sem instalacao do jogo nesta maquina");
            return;
        }

        let saida = std::env::temp_dir().join("kb-fala-teste.wav");
        let _ = std::fs::remove_file(&saida);
        converter(&origem, &saida).expect("deveria decodificar o MP2");

        let b = std::fs::read(&saida).unwrap();
        assert!(b.len() > 1000, "wav curto demais: {} bytes", b.len());
        assert_eq!(&b[0..4], b"RIFF");
        assert_eq!(&b[8..12], b"WAVE");
        // PCM sem compressao, que e o que o OpenAL do jogo espera.
        assert_eq!(u16::from_le_bytes([b[20], b[21]]), 1, "precisa ser PCM");
        let canais = u16::from_le_bytes([b[22], b[23]]);
        let taxa = u32::from_le_bytes([b[24], b[25], b[26], b[27]]);
        assert!(canais >= 1 && canais <= 2, "canais estranhos: {canais}");
        assert!(taxa >= 8000 && taxa <= 48000, "taxa estranha: {taxa}");

        let _ = std::fs::remove_file(&saida);
    }

    /// Converte a instalacao real inteira. Rode com:
    ///   cargo test --lib fala_completa -- --ignored --nocapture
    #[test]
    #[ignore]
    fn fala_completa_da_instalacao() {
        let base = PathBuf::from(std::env::var("LOCALAPPDATA").unwrap())
            .join("KamBrasil/game/data/sfx");
        let pasta = if base.join("speech.eng").is_dir() { base.join("speech.eng") } else { base.join("speech") };

        let t = std::time::Instant::now();
        let n = converter_falas(&pasta, |i, total| {
            if i % 100 == 0 { eprintln!("  {i}/{total}"); }
        });
        eprintln!("convertidos: {n} em {:?}", t.elapsed());
        assert!(n > 400, "esperava mais de 400 arquivos, converteu {n}");
    }
}
