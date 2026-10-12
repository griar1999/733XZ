// Scrolling helpers shared by the app shell and navigation.
/** How far the content is scrolled. On phones the content area scrolls, on computers the page does. */
export function scrolledBy(): number {
  const m = document.getElementById('main');
  return Math.max(window.scrollY || 0, m ? m.scrollTop : 0);
}
/** Back to the top of the screen. */
export function scrollToTop() {
  try { window.scrollTo(0, 0); } catch { /* ignore */ }
  const m = document.getElementById('main'); if (m) m.scrollTop = 0;
}
