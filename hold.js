// Ownership is per physical press: a stale finger/key release cannot end a newer hold.
let owner = null;
export function bindHold(button, begin, end) {
  const presses = new Map();
  const release = (id) => {
    const token = presses.get(id);
    presses.delete(id);
    if (token && owner === token) {
      owner = null;
      end();
    }
  };
  const press = (id) => {
    const token = {};
    presses.set(id, token);
    owner = token;
    begin();
  };
  button.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || button.disabled) return;
    e.preventDefault();
    button.focus();
    button.setPointerCapture(e.pointerId);
    press(`pointer:${e.pointerId}`);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
    button.addEventListener(name, (e) => release(`pointer:${e.pointerId}`));
  button.addEventListener("blur", () => [...presses.keys()].forEach(release));
  button.addEventListener("keydown", (e) => {
    if (!["Space", "Enter"].includes(e.code)) return;
    e.preventDefault();
    if (!e.repeat && !button.disabled) press(`key:${e.code}`);
  });
  button.addEventListener("keyup", (e) => {
    if (["Space", "Enter"].includes(e.code)) {
      e.preventDefault();
      release(`key:${e.code}`);
    }
  });
}
