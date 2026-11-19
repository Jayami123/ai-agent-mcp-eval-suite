/** A minimal SKILL.md. Fake content only. */
export function skillMd(name: string, description: string, body = "Say hello.", extraFrontmatter: string[] = []): string {
  return ["---", `name: ${name}`, `description: ${description}`, ...extraFrontmatter, "---", `# ${name}`, body, ""].join("\n");
}
