import { loadName } from "./name";
import { loadAge } from "./age";
export async function profile(namePath: string, agePath: string): Promise<{ name: string; age: number }> {
  return { name: await loadName(namePath), age: await loadAge(agePath) };
}
