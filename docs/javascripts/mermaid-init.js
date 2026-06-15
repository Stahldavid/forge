(function () {
  function convertMermaidCodeBlocks() {
    document.querySelectorAll("pre > code.language-mermaid").forEach(function (code) {
      var pre = code.parentElement;
      if (!pre || pre.dataset.mermaidConverted === "true") {
        return;
      }

      var diagram = document.createElement("div");
      diagram.className = "mermaid";
      diagram.textContent = code.textContent || "";
      pre.dataset.mermaidConverted = "true";
      pre.replaceWith(diagram);
    });
  }

  function renderMermaid() {
    convertMermaidCodeBlocks();
    if (!window.mermaid) {
      return;
    }

    window.mermaid.initialize({
      startOnLoad: false,
      theme: document.body.getAttribute("data-md-color-scheme") === "slate" ? "dark" : "default",
    });

    window.mermaid.run({ querySelector: ".mermaid" });
  }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(renderMermaid);
  } else {
    document.addEventListener("DOMContentLoaded", renderMermaid);
  }
})();
