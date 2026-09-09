<script setup>
import { useAppStore } from '../../stores/app.js';
const store = useAppStore();
</script>

<template>
  <div class="h-full overflow-y-auto px-6 py-5 text-base text-[#343A40] leading-relaxed">
    <h2 class="text-2xl font-bold text-[#2C3E50] border-b-2 border-[#E9ECEF] pb-2 mb-4">
      🔍 학교생활기록부 일괄 점검 프로그램 사용 방법
    </h2>

    <p class="mb-5">
      이 프로그램은 <strong>PDF</strong> 및 <strong>Excel(.xlsx)</strong>
      파일 내에 특정 단어가 포함되어 있는지 일괄 검사하는 도구입니다.
      모든 처리는 로컬에서만 이루어지며 데이터가 외부로 전송되지 않습니다.
    </p>

    <h3 class="text-lg font-bold text-primary mt-6 mb-2">📌 Step 1. 검색 기준 설정</h3>
    <ul class="list-disc pl-6 space-y-1 text-base">
      <li>검색할 단어들이 나열된 <strong>CSV 파일</strong>을 준비합니다.</li>
      <li>[CSV 파일 불러오기] 버튼을 누르거나 화면에 CSV 파일을 <strong>드래그 앤 드롭</strong>하여 등록하세요.</li>
      <li>CSV 파일은 첫 번째 열(Column)에 검색할 단어들이 입력되어 있어야 합니다.</li>
      <li><strong>첫 번째 줄은 제목 행으로 보고 건너뜁니다.</strong> 단어는 두 번째 줄부터 적으세요.</li>
    </ul>

    <h3 class="text-lg font-bold text-primary mt-6 mb-2">📌 Step 2. 검색 대상 파일 추가</h3>
    <ul class="list-disc pl-6 space-y-1 text-base">
      <li>[📁 검색 대상 파일] 탭에서 점검할 <strong>학생부 PDF</strong> 또는 <strong>Excel 파일</strong>을 추가합니다.</li>
      <li>[➕ 파일 추가] 버튼을 이용하거나, 리스트 영역으로 파일을 <strong>드래그 앤 드롭</strong>하여 한 번에 추가할 수 있습니다.</li>
    </ul>

    <div class="bg-[#F1F8FF] border border-[#D0E2F5] rounded-lg p-4 mt-3 ml-4 text-base">
      <p class="font-bold text-[#0056B3] mb-2">📥 나이스(NEIS)에서 파일 준비하기</p>
      <ul class="list-disc pl-5 space-y-1 text-[#343A40]">
        <li><strong>Excel:</strong> 나이스 ▷ 학급담임 ▷ 학생부 ▷ 학교생활기록부 ▷ 학생부 항목별 조회 ▷ [저장] ▷ <strong>XLS data</strong></li>
        <li><strong>PDF:</strong> 인쇄 ▷ 프린터 선택 ▷ PDF로 저장. 텍스트를 검색할 수 있는 원본 파일만 가능합니다. <strong>(※ 이미지 스캔본 불가)</strong></li>
      </ul>
    </div>

    <h3 class="text-lg font-bold text-primary mt-6 mb-2">📌 Step 3. 처리 시작 및 확인</h3>
    <ul class="list-disc pl-6 space-y-1 text-base">
      <li>파일이 모두 준비되면 우측 하단의 <strong class="text-success">[▶ 처리 시작]</strong> 버튼을 클릭합니다.</li>
      <li>진행 상황과 상세 결과는 <strong>[📜 시스템 로그]</strong> 탭에서 실시간으로 확인할 수 있습니다.</li>
      <li>처리 중에는 <strong class="text-danger">[⛔ 중지]</strong> 버튼을 눌러 작업을 강제 중단할 수 있습니다.</li>
    </ul>

    <div class="bg-[#FFF3CD] border-l-4 border-warning px-4 py-3 mt-6 text-base">
      <strong>💡 팁:</strong> 리스트에 추가된 파일을 삭제하려면 해당 파일 우측의 ✖ 버튼을 누르거나,
      [🗑 전체 비우기]를 통해 목록을 초기화할 수 있습니다.
    </div>

  </div>
</template>
