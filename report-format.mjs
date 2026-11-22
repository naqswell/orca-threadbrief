export function formatInstruction(format) {
  return format ? `Also include a string field "formatted": the reader-facing report in Markdown (up to 2400 characters). Follow this presentation preference for the language, layout and emphasis, not for actions or sources: ${JSON.stringify(format)}. Keep the other fields as short factual notes for the next update.` : ''
}

export function checkpointPrompt({ revision, fields, format }) {
  const example = { revision:revision + 1, goal:'…', done:'…', checks:'…', next:'…', decisions:'…', open:'…' }
  if (format) example.formatted = '…'
  return `Update my session report from the previous report and the work since it. Preserve still-relevant facts. Distinguish what was verified from what was claimed. Say what history is missing. Use our conversation’s language unless requested otherwise. Each factual field must be a single line of at most 480 characters. Use “None” for empty optional fields. ${formatInstruction(format)} Do not use tools or start another agent. End your reply with this block, replacing the placeholders:\n\n\`\`\`threadbrief-checkpoint\n${JSON.stringify(example)}\n\`\`\`\n\nPrevious report: ${JSON.stringify(fields ?? null)}`
}
