import { Router, Request, Response } from "express";
import { supabase } from "../supabaseClient";

const router = Router();

// ─── Types ────────────────────────────────────────────────────────────────────

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
}

interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  sender_chat?: TelegramChat;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  entities?: TelegramMessageEntity[];
  caption_entities?: TelegramMessageEntity[];
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract #hashtags from a message and return them as clean tag strings.
 * e.g. "Hello world #React #TypeScript" → ["React", "TypeScript"]
 */
const extractHashtags = (text: string): string[] => {
  const matches = text.match(/#[\w]+/g) ?? [];
  return matches.map((t) => t.replace("#", "").trim()).filter(Boolean);
};

/**
 * Strip hashtags from the post body so they don't appear in the content.
 */
const stripHashtags = (text: string): string =>
  text.replace(/#[\w]+/g, "").trim();

/**
 * Build the public Telegram message link.
 * Works for public channels that have a username.
 */
const buildPostLink = (chat: TelegramChat, messageId: number): string => {
  if (chat.username) {
    return `https://t.me/${chat.username}/${messageId}`;
  }
  // For private channels the id starts with -100; strip that prefix
  const channelId = String(chat.id).replace(/^-100/, "");
  return `https://t.me/c/${channelId}/${messageId}`;
};

/**
 * Upsert a tag and return its id.
 */
const upsertTag = async (tagName: string): Promise<number> => {
  const { data, error } = await supabase
    .from("Tag")
    .upsert({ tag: tagName }, { onConflict: "tag" })
    .select("id")
    .single();

  if (error) throw new Error(`Tag upsert failed: ${error.message}`);
  return (data as { id: number }).id;
};

// ─── POST /webhook/telegram ───────────────────────────────────────────────────

router.post("/telegram", async (req: Request, res: Response) => {
  // Always respond 200 immediately — Telegram will retry if we don't
  res.sendStatus(200);

  try {
    const update: TelegramUpdate = req.body;

    // We only care about new channel posts (not edits, not private messages)
    const message = update.channel_post;
    if (!message) return;

    const rawText = message.text ?? message.caption ?? "";
    if (!rawText) return;

    // ── Verify it's from the expected channel (optional but recommended) ──
    const allowedChannelId = process.env.TELEGRAM_CHANNEL_ID;
    if (
      allowedChannelId &&
      String(message.chat.id) !== String(allowedChannelId)
    ) {
      console.warn(
        `[Telegram] Ignored message from unknown chat: ${message.chat.id}`
      );
      return;
    }

    const tags = extractHashtags(rawText);
    const cleanPost = stripHashtags(rawText);
    const postLink = buildPostLink(message.chat, message.message_id);

    const postedAt = new Date(message.date * 1000); // TG sends Unix seconds
    const dateString = postedAt.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const dateISO = postedAt.toISOString().split("T")[0]; // "YYYY-MM-DD"

    console.log(`[Telegram] New post from @${message.chat.username ?? message.chat.id}`);
    console.log(`[Telegram] Tags: ${tags.join(", ") || "none"}`);
    console.log(`[Telegram] Link: ${postLink}`);

    // ── Insert the post ──────────────────────────────────────────────────────
    const { data: postData, error: postError } = await supabase
      .from("Post")
      .insert({
        post: cleanPost,
        post_link: postLink,
        date_string: dateString,
        date: dateISO,
      })
      .select("id")
      .single();

    if (postError) {
      console.error("[Telegram] Failed to insert post:", postError.message);
      return;
    }

    const newPostId: number = (postData as { id: number }).id;

    // ── Link tags ────────────────────────────────────────────────────────────
    for (const tagName of tags) {
      const tagId = await upsertTag(tagName);
      const { error: linkError } = await supabase
        .from("PostTag")
        .insert({ post_id: newPostId, tag_id: tagId });

      if (linkError) {
        console.error(`[Telegram] Failed to link tag "${tagName}":`, linkError.message);
      }
    }

    console.log(`[Telegram] ✅ Post #${newPostId} saved with ${tags.length} tag(s)`);
  } catch (err) {
    console.error("[Telegram] Unexpected error:", (err as Error).message);
  }
});

export default router;
