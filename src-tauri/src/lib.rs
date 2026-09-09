use std::path::{Path, PathBuf};

const EMBEDDED_KEYWORDS: &str = include_str!("resources/embedded_keywords.csv");

// 읽고 쓸 수 있는 형식을 좁혀 둔다.
//
// Tauri 2에서 앱이 직접 만든 커맨드는 capability/ACL 검사를 거치지 않는다.
// 그래서 capabilities/default.json에 fs 권한을 한 줄도 안 줬어도, 아래
// 커맨드가 경로를 검증하지 않으면 스코프 없는 fs:allow-read-file /
// fs:allow-write-file을 준 것과 같아진다. 이 앱은 신뢰할 수 없는 외부
// PDF·XLSX를 파싱하므로, 파서 취약점 하나가 곧바로 전체 파일시스템
// 읽기·쓰기로 번지는 사슬이 된다.
const READABLE_EXTENSIONS: [&str; 3] = ["csv", "pdf", "xlsx"];
const WRITABLE_EXTENSIONS: [&str; 2] = ["pdf", "xlsx"];
const OUTPUT_PREFIX: &str = "output_";

#[derive(serde::Serialize)]
struct CsvLoadResult {
    // 바이트 그대로 넘긴다. read_to_string은 UTF-8만 받으므로, 한국 윈도우
    // Excel이 저장한 CP949 default.csv를 "파일이 없는 것"처럼 취급해
    // 조용히 내장 목록으로 넘어가 버린다. 디코딩은 프런트엔드에 한 곳으로 모았다.
    content: Vec<u8>,
    source: String, // "default_file" | "embedded"
    // 파일이 있는데 못 읽은 경우를 프런트엔드가 알 수 있게 한다.
    warning: Option<String>,
}

fn extension_of(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
}

fn ensure_readable(path: &Path) -> Result<(), String> {
    match extension_of(path) {
        Some(ext) if READABLE_EXTENSIONS.contains(&ext.as_str()) => Ok(()),
        Some(ext) => Err(format!("읽을 수 없는 형식입니다: .{ext}")),
        None => Err("확장자가 없는 파일은 읽지 않습니다.".to_string()),
    }
}

fn ensure_writable(path: &Path) -> Result<(), String> {
    match extension_of(path) {
        Some(ext) if WRITABLE_EXTENSIONS.contains(&ext.as_str()) => {}
        Some(ext) => return Err(format!("쓸 수 없는 형식입니다: .{ext}")),
        None => return Err("확장자가 없는 파일에는 쓰지 않습니다.".to_string()),
    }

    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "파일 이름을 읽을 수 없습니다.".to_string())?;
    if !name.starts_with(OUTPUT_PREFIX) {
        return Err(format!(
            "결과 파일 이름은 '{OUTPUT_PREFIX}'로 시작해야 합니다: {name}"
        ));
    }

    // 링크를 따라가면 위 확장자 제한을 우회해 엉뚱한 파일을 덮어쓸 수 있다.
    if let Ok(meta) = std::fs::symlink_metadata(path) {
        if meta.file_type().is_symlink() {
            return Err("심볼릭 링크에는 쓰지 않습니다.".to_string());
        }
    }
    Ok(())
}

// 개발 모드에서 참고할 프로젝트 루트의 default.csv.
//
// 예전에는 상대 경로 "default.csv"였는데, tauri dev는 cargo를 src-tauri에서
// 실행하므로 작업 디렉터리가 프로젝트 루트가 아니다. 그래서 개발 중에는
// default.csv를 고쳐도 반영되지 않고 항상 내장 목록으로 떨어졌다.
#[cfg(debug_assertions)]
fn dev_csv_path() -> Option<PathBuf> {
    Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("../default.csv"))
}

#[cfg(not(debug_assertions))]
fn dev_csv_path() -> Option<PathBuf> {
    None
}

// 있으면 읽고, 없으면 None. 있는데 못 읽으면 그 이유를 돌려준다 —
// "파일이 없다"와 "파일이 잠겨 있다"가 똑같이 내장 목록으로 귀결되면,
// 사용자가 편집한 단어 목록이 조용히 무시된 것을 알 방법이 없다.
fn read_optional(path: &Path) -> (Option<Vec<u8>>, Option<String>) {
    match std::fs::read(path) {
        Ok(content) => (Some(content), None),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (None, None),
        Err(e) => (
            None,
            Some(format!("{} 을(를) 읽지 못했습니다: {e}", path.display())),
        ),
    }
}

#[tauri::command]
fn load_default_csv() -> CsvLoadResult {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // 릴리즈(포터블): exe 옆에 있는 default.csv 우선
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("default.csv"));
        }
    }
    candidates.extend(dev_csv_path());

    let mut warning = None;
    for path in candidates {
        let (content, err) = read_optional(&path);
        if let Some(content) = content {
            return CsvLoadResult {
                content,
                source: "default_file".into(),
                warning,
            };
        }
        // 첫 번째 실패 이유를 남긴다.
        warning = warning.or(err);
    }

    CsvLoadResult {
        content: EMBEDDED_KEYWORDS.as_bytes().to_vec(),
        source: "embedded".into(),
        warning,
    }
}

// 바이트를 Vec<u8>로 돌려주면 serde_json이 [37,80,68,70,...] 형태의 JSON
// 숫자 배열로 직렬화한다. 20MB PDF가 IPC 문자열 70MB로 부풀고, 웹뷰는
// 그것을 다시 파싱한다. Response로 감싸면 원시 바이트로 건너가 ArrayBuffer로
// 받는다.
#[tauri::command]
fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let path = PathBuf::from(path);
    ensure_readable(&path)?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

// 헤더 값은 ASCII만 담을 수 있어 프런트엔드가 encodeURIComponent로 보낸다.
fn percent_decode(input: &str) -> Result<String, String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'%' {
            out.push(bytes[i]);
            i += 1;
            continue;
        }
        let hex = bytes
            .get(i + 1..i + 3)
            .and_then(|h| std::str::from_utf8(h).ok())
            .and_then(|h| u8::from_str_radix(h, 16).ok())
            .ok_or_else(|| "경로 인코딩이 잘못되었습니다.".to_string())?;
        out.push(hex);
        i += 3;
    }
    String::from_utf8(out).map_err(|_| "경로가 UTF-8이 아닙니다.".to_string())
}

// 쓰기도 같은 이유로 원시 바이트를 받는다. 경로는 헤더에 실어 보낸다 —
// 원시 본문 커맨드는 본문 전체가 바이트라서 인자를 함께 못 싣는다.
#[tauri::command]
fn write_file_bytes(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let encoded = request
        .headers()
        .get("path")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "경로 헤더가 없습니다.".to_string())?;
    let path = PathBuf::from(percent_decode(encoded)?);
    ensure_writable(&path)?;

    let data = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes,
        _ => return Err("바이트 본문이 아닙니다.".to_string()),
    };

    write_bytes_atomically(&path, data)
}

// 임시 파일에 쓰고 바꿔치기한다. std::fs::write는 곧바로 대상 파일을
// 잘라내므로, 대용량 PDF를 쓰다가 디스크가 차거나 프로세스가 죽으면
// 손상된 결과 파일이 남는다.
fn write_bytes_atomically(path: &Path, data: &[u8]) -> Result<(), String> {
    let temp = path.with_extension("part");
    std::fs::write(&temp, data).map_err(|e| e.to_string())?;

    if let Err(e) = std::fs::rename(&temp, path) {
        let _ = std::fs::remove_file(&temp);
        return Err(e.to_string());
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            load_default_csv,
            read_file_bytes,
            write_file_bytes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_allows_only_supported_extensions() {
        assert!(ensure_readable(Path::new("C:/a/b.pdf")).is_ok());
        assert!(ensure_readable(Path::new("C:/a/b.XLSX")).is_ok());
        assert!(ensure_readable(Path::new("C:/a/b.csv")).is_ok());
        assert!(ensure_readable(Path::new("C:/Users/u/.ssh/id_rsa")).is_err());
        assert!(ensure_readable(Path::new("C:/a/b.exe")).is_err());
    }

    #[test]
    fn write_allows_only_output_prefixed_results() {
        assert!(ensure_writable(Path::new("C:/a/output_b.pdf")).is_ok());
        assert!(ensure_writable(Path::new("C:/a/output_b.xlsx")).is_ok());
        // 원본을 덮어쓰지 못한다
        assert!(ensure_writable(Path::new("C:/a/b.pdf")).is_err());
        // 시작프로그램에 스크립트를 심지 못한다
        assert!(ensure_writable(Path::new("C:/Users/u/Startup/output_x.bat")).is_err());
        assert!(ensure_writable(Path::new("C:/a/output_b")).is_err());
    }

    #[test]
    fn percent_decode_restores_korean_paths() {
        assert_eq!(
            percent_decode("C%3A%2Fa%2Foutput_%EC%83%9D%EA%B8%B0%EB%B6%80.pdf").unwrap(),
            "C:/a/output_생기부.pdf"
        );
        assert_eq!(
            percent_decode("C:/a/output_b.pdf").unwrap(),
            "C:/a/output_b.pdf"
        );
        assert!(percent_decode("%E").is_err());
        assert!(percent_decode("%ZZ").is_err());
    }

    #[test]
    fn atomic_write_leaves_no_temp_file() {
        let dir = std::env::temp_dir().join("wordfinder_write_test");
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("output_t.pdf");

        write_bytes_atomically(&target, b"%PDF-1.4").unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"%PDF-1.4");
        assert!(!target.with_extension("part").exists());

        // 덮어쓰기도 동작한다
        write_bytes_atomically(&target, b"%PDF-2.0").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"%PDF-2.0");

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
