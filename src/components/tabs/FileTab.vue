<script setup>
import { useAppStore } from '../../stores/app.js';
import { X } from '@lucide/vue';

const store = useAppStore();

const STATUS_CLASS = {
  '대기': '',
  '처리중': 'bg-status-processing',
  '성공': 'bg-status-done',
  '실패': 'bg-status-failed',
  '중단': 'bg-status-stopped',
};
</script>

<template>
  <div class="flex flex-col h-full p-2.5 gap-2">
    <!-- 툴바 -->
    <div class="flex items-center gap-2 shrink-0">
      <span class="text-base text-app-muted flex-1">
        검사 대상 파일(*.pdf, *.xlsx)을 드래그해서 추가하세요
      </span>
      <button
        class="px-3 py-1.5 bg-primary text-white font-bold text-base rounded hover:bg-primary-hover transition-colors"
        :disabled="store.isProcessing"
        @click="store.selectFiles()"
      >
        ➕ 파일 추가
      </button>
      <button
        class="px-3 py-1.5 bg-[#E9ECEF] text-[#495057] font-bold text-base rounded hover:bg-[#DEE2E6] transition-colors"
        :disabled="store.isProcessing"
        @click="store.clearFiles()"
      >
        🗑 전체 비우기
      </button>
    </div>

    <!-- 파일 테이블 -->
    <div class="flex-1 min-h-0 border border-[#E9ECEF] rounded-lg overflow-y-auto">
      <table class="w-full text-base border-collapse">
        <thead class="sticky top-0 z-10">
          <tr class="bg-[#F1F3F5] text-[#495057] font-bold border-b-2 border-[#DEE2E6]">
            <th class="text-left px-3 py-2">파일명</th>
            <th class="w-24 text-center px-3 py-2 whitespace-nowrap">상태</th>
            <th class="w-14 text-center px-3 py-2 whitespace-nowrap">삭제</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(file, i) in store.files"
            :key="file.id"
            class="border-b border-[#F1F3F5] last:border-0"
            :class="[STATUS_CLASS[file.status], i % 2 === 1 && !STATUS_CLASS[file.status] ? 'bg-app-bg' : '']"
          >
            <td class="px-3 py-2.5 truncate max-w-0 w-full">{{ file.name }}</td>
            <td class="w-24 text-center px-3 py-2.5 font-bold whitespace-nowrap">{{ file.status }}</td>
            <td class="w-14 text-center px-1 py-1">
              <button
                class="w-7 h-7 rounded flex items-center justify-center mx-auto text-[#ADB5BD] hover:bg-[#FFE3E3] hover:text-danger transition-colors"
                :disabled="store.isProcessing"
                @click="store.removeFile(file.id)"
              >
                <X :size="14" />
              </button>
            </td>
          </tr>
          <tr v-if="store.files.length === 0">
            <td colspan="3" class="text-center text-app-muted py-10">
              파일을 드래그하거나 [➕ 파일 추가] 버튼으로 추가하세요
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
