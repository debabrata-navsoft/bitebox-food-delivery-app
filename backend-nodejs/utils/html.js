const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes text for HTML email bodies. */
export const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
