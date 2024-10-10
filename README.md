# PDF 유의어 검사 프로그램

## 개요
이 프로그램은 CSV 파일에 있는 유의어 목록이 PDF 속에 존재하는지 검색합니다.  
GUI(그래픽 사용자 인터페이스)를 통해 파일을 쉽게 선택할 수 있습니다.  

## 주요 기능
- CSV 파일의 인코딩을 자동으로 감지합니다.
- PDF 파일에서 유의어를 찾아 강조 표시합니다.
- 발견된 유의어의 개수를 요약하여 텍스트 파일로 저장합니다.

## 버전 정보
이 프로그램은 두 가지 버전이 있습니다:

1. **PyMuPDF 버전**
   - **파일 크기**: 큼
   - **생성 파일**: 하이라이트 된 PDF, 검색 결과 TXT
   - **설명**: PyMuPDF 라이브러리를 사용하여 PDF를 처리합니다. 유의어를 노란 형광펜으로 강조 표시한 PDF 파일을 생성합니다.

2. **PyPDF2 버전**
   - **파일 크기**: 작음
   - **생성 파일**: Only 검색 결과 TXT
   - **설명**: PyPDF2 라이브러리를 사용하여 PDF를 처리하며 파일 크기가 작은 대신 처리 속도가 좋습니다. 단순히 몇 페이지에 어떤 유의어가 발견되었는지 여부만 생성합니다.

## 사용 방법
1. 프로그램을 실행합니다.
2. 유의어가 포함된 CSV 파일과 검색할 PDF 파일을 선택합니다.
3. 프로그램이 PDF 파일을 처리하여 결과를 도출합니다.

## 유의어 CSV 파일 형식
CSV 파일은 `synonym`이라는 열을 포함해야 하며, 검색할 유의어 목록이 들어 있어야 합니다.  

예시:

```
synonym
example1
example2
```

## 제작자 및 버전
- **제작자**: itmir913@gmail.com
- **버전**: 2024-10-10

## 코드 구조

### 프로그래밍 언어
- Python

### 상수
- `HIGHLIGHTED_SUFFIX`: 강조된 PDF 파일의 접미사입니다.
- `SYNONYM_COUNTS_SUFFIX`: 유의어 개수를 저장할 텍스트 파일의 접미사입니다.

### 주요 함수
- `detect_encoding(file_path)`: CSV 파일의 인코딩을 감지합니다.
- `read_synonyms_from_csv(csv_file)`: CSV 파일에서 유의어를 읽어옵니다.
- `save_synonym_counts_to_txt(synonym_counts, output_file)`: 발견된 유의어의 개수를 텍스트 파일에 저장합니다.
- `highlight_words_in_pdf(pdf_path, csv_file, status_message_var)`: PDF 파일에서 유의어를 강조합니다.
- `select_files(status_message_var)`: PDF 및 CSV 파일을 선택하는 대화상자를 엽니다.
- `setup_gui()`: GUI 창을 설정합니다.


## 필요한 모듈
- `PyMuPDF` 또는 `PyPDF2`
- `tkinter`
- `chardet`

모듈 설치 방법:
```bash
pip install PyMuPDF PyPDF2 tkinter chardet
```

## 빌드 방법
PyInstaller를 사용하여 두 가지 버전의 프로그램을 빌드할 수 있습니다. 아래 명령어를 사용하세요:

```bash
pyinstaller --onefile --windowed --hidden-import fitz --clean Synonym-Search-Program-PyMuPDF.py
pyinstaller --onefile --windowed --hidden-import PyPDF2 --clean Synonym-Search-Program-PyPDF2.py
```
