<script setup lang="ts">
import { computed } from "vue";
import { useNotes } from "../composables/useNotes";

const { notes } = useNotes();
const noteCount = computed(() => notes.data.value?.length ?? 0);
</script>

<template>
  <section class="notes">
    <div class="section-heading">
      <h2>Live notes</h2>
      <span>{{ noteCount }}</span>
    </div>
    <p v-if="notes.loading.value" class="muted">Loading notes...</p>
    <p v-else-if="notes.error.value" class="error">
      {{ notes.error.value.message }}
    </p>
    <p v-else-if="noteCount === 0" class="muted">No notes yet.</p>
    <ul v-else>
      <li v-for="note in notes.data.value" :key="note.id">
        <strong>{{ note.title }}</strong>
        <p v-if="note.body">{{ note.body }}</p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.notes {
  border: 1px solid #d9ddd0;
  border-radius: 8px;
  background: #ffffff;
  padding: 18px;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.section-heading h2 {
  margin: 0;
  font-size: 1.1rem;
}

.section-heading span {
  display: inline-grid;
  min-width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 999px;
  color: #1f6f54;
  background: #e4f2ec;
  font-weight: 800;
}

ul {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

li {
  border: 1px solid #edf0e7;
  border-radius: 6px;
  padding: 12px;
}

li p {
  margin: 6px 0 0;
  color: #53605a;
}

.muted {
  margin: 0;
  color: #6a756f;
}

.error {
  margin: 0;
  color: #a02d2d;
}
</style>
