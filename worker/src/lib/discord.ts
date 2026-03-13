/**
 * Discord webhook notification helper.
 */
export async function notifyDiscord(webhookUrl: string | undefined, message: string): Promise<boolean> {
  if (!webhookUrl) return false;
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    });
    return res.ok;
  } catch (err) {
    console.error('Discord notification failed:', err);
    return false;
  }
}
