# PDFWordFinder

![1](https://github.com/user-attachments/assets/a78860ed-f79a-49c4-974e-acfb4c927926)

## 개요
PDFWordFinder는 CSV 파일에 있는 단어 목록을 PDF 파일에서 검색하여 각 단어가 포함된 페이지 번호를 알려주는 Python 기반 GUI 프로그램입니다.

## 주요 기능
- CSV 파일의 인코딩을 자동으로 감지
- CSV 파일에서 검색할 단어 목록을 불러옴
- PDF 파일에서 단어를 검색하고 해당 페이지 번호를 출력함
- 손쉬운 그래픽 인터페이스
- 검색한 단어를 형광펜으로 강조(하이라이트)한 PDF 파일 생성

## 버전 정보
이 프로그램은 두 가지 버전이 있습니다.  
  
단어의 존재 유무만 빠르게 확인하시려면 PyPDF2 버전을 사용하세요.  
형광펜 강조 표시가 필요한 경우에는 PyMuPDF 버전을 사용하세요.

1. **PyMuPDF 버전**
   - **파일 크기**: 큼(약 88MB)
   - **생성 파일**: 하이라이트 된 PDF, 검색 결과 TXT
   - **설명**: PyMuPDF 라이브러리를 사용하여 PDF를 처리합니다. 검색된 단어를 노란 형광펜으로 강조 표시한 PDF 파일까지 생성합니다.

2. **PyPDF2 버전**
   - **파일 크기**: 작음(약 13MB)
   - **생성 파일**: Only 검색 결과 TXT
   - **설명**: PyPDF2 라이브러리를 사용하여 PDF를 처리하며 일반적으로 처리 속도가 좋습니다. 몇 페이지에 어떤 단어가 발견되었는지 등 단순한 검색 결과가 담긴 텍스트 파일만 생성합니다.

## 사용 방법
1. 프로그램을 실행합니다.
2. 검색할 단어 목록이 저장된 CSV 파일과 검색 대상 PDF 파일을 선택합니다.
3. 프로그램이 PDF 파일을 처리합니다.

## CSV 파일 형식
CSV 파일은 `words`이라는 열을 포함해야 하며, 이 열에는 검색할 단어의 목록이 들어 있어야 합니다.  

예시:

```
words
example1
example2
```

## 코드 구조

### 프로그래밍 언어
- Python

### 상수
- `HIGHLIGHTED_SUFFIX`: 강조된 PDF 파일의 접미사입니다.
- `SYNONYM_COUNTS_SUFFIX`: 단어 개수를 저장할 텍스트 파일의 접미사입니다.

### 주요 함수
- `detect_encoding(file_path)`: CSV 파일의 인코딩을 감지합니다.
- `read_synonyms_from_csv(csv_file)`: CSV 파일에서 단어를 읽어옵니다.
- `save_synonym_counts_to_txt(synonym_counts, output_file)`: 발견된 단어의 개수를 텍스트 파일에 저장합니다.
- `highlight_words_in_pdf(pdf_path, csv_file, status_message_var)`: PDF 파일에서 단어를 강조 표시합니다.
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
PyInstaller를 사용하여 두 가지 버전의 프로그램을 빌드할 수 있습니다.  
  
아래 명령어를 사용하세요:
```bash
pyinstaller --onefile --windowed --hidden-import fitz --clean PDFWordFinder-PyMuPDF.py
pyinstaller --onefile --windowed --hidden-import PyPDF2 --clean PDFWordFinder-PyPDF2.py
```
