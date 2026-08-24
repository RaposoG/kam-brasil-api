//! Verificação do WebView2, o motor que desenha a interface no Windows.
//!
//! O Tauri não desenha nada sozinho: ele usa o WebView2, que vem com o
//! Microsoft Edge. Quem desinstala o Edge leva o WebView2 junto, e o launcher
//! morre na criação da janela com uma mensagem sobre "webview" que não diz a
//! ninguém o que fazer.
//!
//! Aqui detectamos isso **antes** de tentar abrir a janela e explicamos em
//! português o que aconteceu e como resolver.

/// O WebView2 está instalado nesta máquina?
///
/// A presença é registrada pelo EdgeUpdate em três lugares: máquina 64 bits,
/// máquina 32 bits e usuário. Basta um deles ter versão preenchida.
#[cfg(windows)]
pub fn instalado() -> bool {
    const CLIENTE: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    let chaves = [
        format!(r"HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{CLIENTE}"),
        format!(r"HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{CLIENTE}"),
        format!(r"HKCU\SOFTWARE\Microsoft\EdgeUpdate\Clients\{CLIENTE}"),
    ];

    chaves.iter().any(|chave| {
        std::process::Command::new("reg")
            .args(["query", chave, "/v", "pv"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .map(|s| {
                // A chave pode existir com versao vazia depois de uma remocao
                // parcial -- por isso olhamos o valor, nao so o codigo de saida.
                let texto = String::from_utf8_lossy(&s.stdout);
                s.status.success() && texto.contains("pv") && !texto.contains("REG_SZ    0.0.0.0")
            })
            .unwrap_or(false)
    })
}

#[cfg(not(windows))]
pub fn instalado() -> bool {
    true
}

/// Caixa de diálogo nativa. Não dá para usar o diálogo do Tauri aqui: ele
/// precisa do aplicativo de pé, e o aplicativo é justamente o que não sobe.
#[cfg(windows)]
pub fn avisar(mensagem: &str) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(hwnd: isize, texto: *const u16, titulo: *const u16, tipo: u32) -> i32;
    }

    let largo = |s: &str| OsStr::new(s).encode_wide().chain(Some(0)).collect::<Vec<u16>>();
    let (texto, titulo) = (largo(mensagem), largo("Kam Brasil"));

    // MB_ICONERROR | MB_OK
    unsafe { MessageBoxW(0, texto.as_ptr(), titulo.as_ptr(), 0x10) };
}

#[cfg(not(windows))]
pub fn avisar(mensagem: &str) {
    eprintln!("{mensagem}");
}

pub const RECADO: &str = "O Kam Brasil precisa do WebView2 para funcionar, e ele não está \
instalado nesta máquina.\n\n\
Isso costuma acontecer quando o Microsoft Edge é removido: o WebView2 vai junto.\n\n\
Como resolver, de um jeito ou de outro:\n\n\
1. Instale o launcher novamente — o instalador coloca o WebView2 de volta.\n\n\
2. Ou baixe direto da Microsoft, procurando por \"Evergreen Standalone Installer\" em:\n\
   https://developer.microsoft.com/microsoft-edge/webview2/\n\n\
Depois disso o launcher abre normalmente.";

#[cfg(test)]
mod tests {
    /// Esta maquina tem Edge/WebView2, entao a deteccao PRECISA dizer que sim.
    /// Um falso negativo aqui bloquearia o launcher de quem esta com tudo certo
    /// -- estrago pior que o problema original.
    #[test]
    #[cfg(windows)]
    fn detecta_webview2_presente_nesta_maquina() {
        assert!(
            super::instalado(),
            "esta maquina roda o launcher, entao tem WebView2; a deteccao deu falso negativo"
        );
    }

    /// O recado tem que dizer o que fazer, nao so o que houve.
    #[test]
    fn recado_explica_a_saida() {
        assert!(super::RECADO.contains("WebView2"));
        assert!(super::RECADO.contains("novamente"), "precisa dizer para reinstalar");
        assert!(super::RECADO.contains("microsoft.com"), "precisa do link oficial");
    }
}
