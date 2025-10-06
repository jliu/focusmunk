// block.js
document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(location.search);
  const blocked = params.get("blocked") || "";
  document.getElementById("blockedUrl").textContent = blocked;
});
