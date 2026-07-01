<script setup lang="ts">
import LiveNotes from "./components/LiveNotes.vue";
import NoteComposer from "./components/NoteComposer.vue";
</script>

<template>
  <main class="shell">
    <section class="header">
      <p class="eyebrow">Workspace notes</p>
      <h1>Notes</h1>
    </section>

    <NoteComposer />
    <LiveNotes />
  </main>
</template>

<style>
:root {
  color: #17211d;
  background: #f7f6f0;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

button,
input,
textarea {
  font: inherit;
}

.shell {
  width: min(780px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 48px 0;
}

.header {
  margin-bottom: 24px;
}

.eyebrow {
  margin: 0 0 6px;
  color: #58655f;
  font-size: 0.82rem;
  font-weight: 700;
  text-transform: uppercase;
}

h1,
h2,
p {
  margin-top: 0;
}

h1 {
  margin-bottom: 0;
  font-size: 2.4rem;
}
</style>
