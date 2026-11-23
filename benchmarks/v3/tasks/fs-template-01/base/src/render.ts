import { loadTemplate } from "./template";
import { loadData } from "./data";

export async function render(templatePath: string, dataPath: string): Promise<string> {
  const [template, data] = await Promise.all([loadTemplate(templatePath), loadData(dataPath)]);
  return template.replaceAll("{{name}}", data.name).replaceAll("{{count}}", String(data.count));
}
