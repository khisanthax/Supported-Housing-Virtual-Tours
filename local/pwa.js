const status = document.getElementById("local-offline-status"),
  button = document.getElementById("local-install");
let prompt;
addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  prompt = event;
  if (button) button.hidden = false;
});
if (button)
  button.onclick = async () => {
    await prompt?.prompt();
    prompt = null;
    button.hidden = true;
  };
const connection = () => {
  const n = document.getElementById("local-network-status");
  if (n)
    n.textContent = navigator.onLine
      ? "Device online · projects stay local"
      : "Device offline · projects stay local";
};
addEventListener("online", connection);
addEventListener("offline", connection);
connection();
try {
  if (!isSecureContext || !navigator.serviceWorker)
    throw Error(
      "Use localhost or a trusted HTTPS installation address. Opening files directly cannot install the PWA.",
    );
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller)
    await new Promise((resolve) =>
      navigator.serviceWorker.addEventListener("controllerchange", resolve, {
        once: true,
      }),
    );
  const verified = await new Promise((resolve) => {
    const channel = new MessageChannel(),
      timer = setTimeout(() => resolve(false), 15000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data === true);
    };
    navigator.serviceWorker.controller.postMessage("verify-shell", [
      channel.port2,
    ]);
  });
  if (!verified)
    throw Error(
      "Application caching is incomplete. Keep the static server available and reload before disconnecting.",
    );
  if (status) {
    status.textContent = "Application ready offline";
    status.dataset.ready = "true";
  }
} catch (error) {
  if (status) {
    status.textContent = error.message;
    status.dataset.ready = "false";
  }
}
