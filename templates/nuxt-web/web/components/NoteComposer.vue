<script setup lang="ts">
import { ref } from "vue";
import { useNotes } from "../composables/useNotes";

const title = ref("");
const body = ref("");
const { createNote } = useNotes({
  onCreated: () => {
    title.value = "";
    body.value = "";
  },
});

async function submit() {
  const trimmedTitle = title.value.trim();
  if (!trimmedTitle || createNote.loading.value) {
    return;
  }

  await createNote.run({
    title: trimmedTitle,
    body: body.value.trim(),
  });
}
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <label>
      <span>Title</span>
      <input v-model="title" placeholder="Ship the full-stack loop" />
    </label>
    <label>
      <span>Body</span>
      <textarea v-model="body" placeholder="Optional note" />
    </label>
    <button :disabled="createNote.loading.value || !title.trim()" type="submit">
      {{ createNote.loading.value ? "Creating..." : "Create note" }}
    </button>
    <p v-if="createNote.error.value" class="error">
      {{ createNote.error.value.message }}
    </p>
  </form>
</template>

<style scoped>
.composer {
  display: grid;
  gap: 14px;
  margin-bottom: 18px;
  border: 1px solid #d9ddd0;
  border-radius: 8px;
  background: #ffffff;
  padding: 18px;
}

label {
  display: grid;
  gap: 6px;
  color: #39423e;
  font-size: 0.92rem;
  font-weight: 700;
}

input,
textarea {
  width: 100%;
  border: 1px solid #cfd5c6;
  border-radius: 6px;
  padding: 10px 12px;
  color: #17211d;
  background: #fbfcf8;
}

textarea {
  min-height: 96px;
  resize: vertical;
}

button {
  justify-self: start;
  min-height: 40px;
  border: 0;
  border-radius: 6px;
  padding: 0 14px;
  color: #ffffff;
  background: #1f6f54;
  font-weight: 800;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.error {
  margin: 0;
  color: #a02d2d;
}
</style>
