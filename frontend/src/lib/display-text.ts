// Format quoted Python list fragments for display without changing source data.
export function displayText(text: string): string {
  return text.replace(/\[((?:\s*(?:'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\s*,?\s*)+)\]/g, (fragment, body: string) => {
    const values = body.match(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g);
    if (!values) return fragment;
    return values.map((value) => value.slice(1, -1).replace(/\\(['"\\])/g, "$1")).join(", ");
  });
}
