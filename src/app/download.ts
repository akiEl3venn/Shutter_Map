export function saveBlob(blob: Blob, name: string) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  try {
    link.href = url;
    link.download = name;
    link.hidden = true;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // The browser may start the download after the click handler returns.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
