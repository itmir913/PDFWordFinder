import PyPDF2  # PyPDF2 모듈로 변경
import csv
import os
import tkinter as tk
from tkinter import filedialog, messagebox
import chardet
import threading  # 스레딩 모듈 추가

# 제작자 및 버전 정보
AUTHOR = "운양고등학교 이종환T"
VERSION = "2024-10-10"

# 접미사 변수 선언
SYNONYM_COUNTS_SUFFIX = '_words_counts.txt'

# CSV 파일의 인코딩 자동 감지
def detect_encoding(file_path):
    with open(file_path, 'rb') as f:
        result = chardet.detect(f.read())
        return result['encoding']

# CSV 파일에서 단어 목록 읽기 (제너레이터)
def read_synonyms_from_csv(csv_file):
    encoding = detect_encoding(csv_file)
    try:
        with open(csv_file, mode='r', newline='', encoding=encoding) as file:
            reader = csv.DictReader(file)
            for row in reader:
                yield row['words']
    except Exception as e:
        raise IOError(f"CSV 파일을 읽는 중 오류 발생: {str(e)}")

# 발견된 단어 정보를 txt 파일로 저장
def save_synonym_counts_to_txt(synonym_counts, output_file):
    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            for synonym, pages in synonym_counts.items():
                f.write(f"{synonym}: {len(pages)}번 발견, 페이지: {', '.join(map(str, pages))}\n")
    except Exception as e:
        raise IOError(f"결과를 저장하는 중 오류 발생: {str(e)}")

# PDF에서 단어 강조 및 결과 처리
def highlight_words_in_pdf(pdf_path, csv_file, status_message_var):
    try:
        doc = PyPDF2.PdfReader(pdf_path)
        synonym_counts = {}
        total_pages = len(doc.pages)

        for page_num in range(total_pages):
            page = doc.pages[page_num]
            text = page.extract_text()
            highlight_page_with_synonyms(text, csv_file, synonym_counts, page_num + 1)

            # 진행 상황 업데이트
            status_message_var.set(f"{page_num + 1}/{total_pages} 페이지 처리 중...")

        found_any_synonym = any(len(pages) > 0 for pages in synonym_counts.values())

        if found_any_synonym:
            # 단어 발견 횟수를 txt 파일로 저장
            txt_output_path = pdf_path[:-4] + SYNONYM_COUNTS_SUFFIX
            save_synonym_counts_to_txt(synonym_counts, txt_output_path)

            return found_any_synonym, synonym_counts, txt_output_path  # txt 파일 경로 반환
        else:
            return found_any_synonym, {}, None  # 단어 발견되지 않음

    except Exception as e:
        return False, {}, None, str(e)  # 오류 메시지 반환

# 페이지에서 단어 강조
def highlight_page_with_synonyms(text, csv_file, synonym_counts, page_num):
    for word in read_synonyms_from_csv(csv_file):
        if word in text:
            # 발견된 단어의 카운트를 업데이트
            if word not in synonym_counts:
                synonym_counts[word] = []
            synonym_counts[word].append(page_num)

# 결과 알림 메시지 생성
def create_result_message(found_any_synonym, synonym_counts, txt_output_path):
    if found_any_synonym:
        # 단어 발견 횟수를 문자열로 변환
        synonym_report = "\n".join(
            [f"{synonym}: {len(pages)}번 발견, 페이지: {', '.join(map(str, pages))}" for synonym, pages in synonym_counts.items()]
        )

        message = (
            "PDF 파일 검색 결과 단어가 발견되었습니다!\n\n"
            f"발견된 단어 목록:\n{synonym_report}\n"
        )

        message += (
            f"\n단어 발견 횟수가 {txt_output_path}에 저장되었습니다."
        )
        return message, txt_output_path  # 메시지와 txt 경로 반환
    else:
        return "단어가 발견되지 않아 검색을 종료합니다.", None  # 메시지와 None 반환

# PDF 및 CSV 파일 선택
def select_files(status_message_var):
    csv_file_path = filedialog.askopenfilename(title="CSV 파일 선택", filetypes=[("CSV files", "*.csv")])
    pdf_file_path = filedialog.askopenfilename(title="PDF 파일 선택", filetypes=[("PDF files", "*.pdf")])

    if not csv_file_path or not pdf_file_path:
        messagebox.showerror("오류", "CSV 파일과 PDF 파일을 모두 선택하세요.")
        return

    # 상태 메시지 초기화
    status_message_var.set("처리 중...")

    # 스레드에서 파일 처리 수행
    threading.Thread(target=process_files, args=(pdf_file_path, csv_file_path, status_message_var)).start()

# 파일 처리 스레드 함수
def process_files(pdf_file_path, csv_file_path, status_message_var):
    result = highlight_words_in_pdf(pdf_file_path, csv_file_path, status_message_var)

    if len(result) == 4:  # 오류가 발생한 경우
        found_any_synonym, synonym_counts, txt_output_path, error_message = result
        status_message_var.set("오류")  # 상태 라벨에 오류 표시
        messagebox.showerror("오류 발생", error_message)  # 예외 메시지 알림창
        return

    found_any_synonym, synonym_counts, txt_output_path = result
    message, _ = create_result_message(found_any_synonym, synonym_counts, txt_output_path)

    # 완료 상태 업데이트
    status_message_var.set("완료")  # 완료 상태로 변경
    messagebox.showinfo("결과", message)  # 최종 결과를 한 번만 표시

# GUI 창 설정
def setup_gui():
    root = tk.Tk()
    root.title("PDFWordFinder")

    # 창 크기 설정
    window_width = 400
    window_height = 250
    root.geometry(f"{window_width}x{window_height}")
    root.resizable(False, False)  # 창 크기 고정

    # 창을 화면 중앙에 배치
    screen_width = root.winfo_screenwidth()
    screen_height = root.winfo_screenheight()
    position_top = int(screen_height / 2 - window_height / 2)
    position_right = int(screen_width / 2 - window_width / 2)
    root.geometry(f"+{position_right}+{position_top}")

    # 요소들을 프레임에 추가하여 정렬
    frame = tk.Frame(root)
    frame.pack(padx=20, pady=10)

    # 라벨 및 버튼 가운데 정렬
    label = tk.Label(frame, text="PDF 단어 검색 프로그램.", padx=20, pady=5)
    label.pack()

    # 초기 상태 메시지 추가
    status_message_var = tk.StringVar(value="CSV와 PDF 파일을 선택하세요.")  # 초기 상태 메시지 설정
    status_label = tk.Label(frame, textvariable=status_message_var)  # 진행 상태 라벨
    status_label.pack(pady=10)  # 패딩 추가

    select_button = tk.Button(frame, text="CSV 및 PDF 파일 선택", command=lambda: select_files(status_message_var), padx=10,
                              pady=5)
    select_button.pack(pady=5)

    exit_button = tk.Button(frame, text="종료", command=root.quit, padx=10, pady=5)
    exit_button.pack(pady=5)

    # 만든이 정보 라벨 추가
    author_label = tk.Label(frame, text=f"제작자: {AUTHOR}\n버전: {VERSION}", padx=20, pady=2)
    author_label.pack()

    return root

# GUI 실행
if __name__ == "__main__":
    app_root = setup_gui()
    app_root.mainloop()
