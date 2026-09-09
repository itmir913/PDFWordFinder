<script setup>
import { watch, nextTick, ref, onMounted, onActivated } from 'vue';
import { useAppStore } from '../../stores/app.js';

const store = useAppStore();
const logEl = ref(null);

async function scrollToBottom() {
  await nextTick();
  if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight;
}

watch(() => store.logs.length, scrollToBottom);

// 탭을 옮겼다 돌아오면 맨 위가 보였다. 새 로그가 한 줄 더 찍혀야만
// 아래로 내려갔는데, 처리가 끝난 뒤라면 영영 수동 스크롤해야 했다.
onMounted(scrollToBottom);
onActivated(scrollToBottom);
</script>

<template>
  <div class="h-full p-2.5">
    <div
      ref="logEl"
      class="h-full bg-[#212529] text-[#C1C9D2] rounded-lg p-3 overflow-y-auto font-mono text-base leading-6 select-text cursor-text"
    >
      <div v-for="(line, i) in store.logs" :key="i">{{ line }}</div>
      <div v-if="store.logs.length === 0" class="text-[#6C757D]">로그가 여기 표시됩니다.</div>
    </div>
  </div>
</template>
