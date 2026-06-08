import type { TgMessage, InlineKeyboard } from "../types/telegram";
import { BotCommand } from "../types";
import { DBService } from "../services/database";
import { i18n } from "../services/i18n";
import { logger } from "../utils/logger";

const TIME_REGEX = /^(\d{1,2}):(\d{2})$/;
const MAX_LIST_ITEMS = 15;
const MAX_CONTENT_PREVIEW = 80;

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function pickLocale(lang: string): string {
  if (lang === "ru") return "ru-RU";
  if (lang === "uz") return "uz-UZ";
  return "en-GB";
}

function formatScheduleTime(iso: string, lang: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return date.toLocaleString(pickLocale(lang), {
      timeZone: "Asia/Tashkent",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return date.toISOString();
  }
}

function extractContentText(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content);
      return extractContentText(parsed);
    } catch {
      return content;
    }
  }
  if (typeof content === "object") {
    const obj = content as { text?: unknown; caption?: unknown };
    return String(obj.text || obj.caption || "").slice(0, MAX_CONTENT_PREVIEW);
  }
  return String(content).slice(0, MAX_CONTENT_PREVIEW);
}

export function buildScheduleListKeyboard(
  posts: Array<{ id: number | string }>,
  lang: string,
): InlineKeyboard {
  const rows: InlineKeyboard = posts.map((post) => [
    { text: `${i18n.t("bot_schedule_btn_view", { lng: lang })} #${post.id}`, callback_data: `sched_view_${post.id}` },
    { text: `${i18n.t("bot_schedule_btn_cancel", { lng: lang })} #${post.id}`, callback_data: `sched_cancel_${post.id}` },
  ]);
  rows.push([{ text: i18n.t("bot_schedule_btn_refresh", { lng: lang }), callback_data: "sched_list" }]);
  return rows;
}

export function renderScheduleList(
  posts: Array<Record<string, unknown>>,
  lang: string,
): { text: string; keyboard: InlineKeyboard } {
  const pending = posts.filter((p) => p.status === "pending");
  if (pending.length === 0) {
    return {
      text: i18n.t("bot_schedule_list_empty", { lng: lang }),
      keyboard: [[{ text: i18n.t("bot_schedule_btn_refresh", { lng: lang }), callback_data: "sched_list" }]],
    };
  }

  const slice = pending.slice(0, MAX_LIST_ITEMS);
  const lines: string[] = [i18n.t("bot_schedule_list_header", { lng: lang }), ""];
  slice.forEach((p, idx) => {
    const id = String(p.id);
    const when = formatScheduleTime(String(p.scheduled_at), lang);
    const preview = escapeHtml(extractContentText(p.content) || `(${String(p.type)})`);
    const typeEmoji = p.type === "video" ? "📹" : p.type === "audio" ? "🎵" : "📝";
    lines.push(`${idx + 1}. ${typeEmoji} <b>#${escapeHtml(id)}</b> · <i>${escapeHtml(when)}</i>\n    ${preview}`);
  });
  if (pending.length > MAX_LIST_ITEMS) {
    lines.push("", `<i>… +${pending.length - MAX_LIST_ITEMS}</i>`);
  }
  return { text: lines.join("\n"), keyboard: buildScheduleListKeyboard(slice as unknown as { id: string | number }[], lang) };
}

export function renderScheduleView(post: Record<string, unknown>, lang: string): { text: string; keyboard: InlineKeyboard } {
  const id = String(post.id);
  const when = formatScheduleTime(String(post.scheduled_at), lang);
  const type = String(post.type || "text");
  const status = String(post.status || "pending");
  const content = extractContentText(post.content) || i18n.t("bot_schedule_view_empty_content", { lng: lang });

  const text = [
    `📅 <b>${i18n.t("bot_schedule_view_title", { lng: lang })}</b>`,
    "",
    `<b>${i18n.t("bot_schedule_view_field_id", { lng: lang })}:</b> #${escapeHtml(id)}`,
    `<b>${i18n.t("bot_schedule_view_field_type", { lng: lang })}:</b> ${escapeHtml(type)}`,
    `<b>${i18n.t("bot_schedule_view_field_time", { lng: lang })}:</b> ${escapeHtml(when)}`,
    `<b>${i18n.t("bot_schedule_view_field_status", { lng: lang })}:</b> ${escapeHtml(status)}`,
    "",
    `<b>${i18n.t("bot_schedule_view_field_content", { lng: lang })}:</b>`,
    escapeHtml(content),
  ].join("\n");

  const keyboard: InlineKeyboard = [
    [{ text: i18n.t("bot_schedule_btn_cancel", { lng: lang }), callback_data: `sched_cancel_${id}` }],
    [{ text: i18n.t("bot_schedule_btn_list", { lng: lang }), callback_data: "sched_list" }],
  ];
  return { text, keyboard };
}

function buildNextScheduleDate(h: number, m: number): Date {
  const now = new Date();
  const scheduled = new Date();
  scheduled.setHours(h, m, 0, 0);
  if (scheduled.getTime() <= now.getTime()) {
    scheduled.setDate(scheduled.getDate() + 1);
  }
  return scheduled;
}

export const scheduleCommand: BotCommand = {
  pattern: /^\/schedule(?:@\w+)?(?:\s+(.+))?$/i,
  description: "📅 Schedule a post",
  handler: async (bot: any, msg: TgMessage, match: RegExpExecArray | null) => {
    const chatId = msg.chat.id;
    const user = await DBService.getUser(chatId);
    const lang = (user?.language || "uz") as string;
    const argsRaw = (match?.[1] || "").trim();

    try {
      if (/^list\b/i.test(argsRaw)) {
        const posts = (await DBService.getUserScheduledPosts(chatId)) as Array<Record<string, unknown>>;
        const rendered = renderScheduleList(posts, lang);
        await bot.sendMessage(chatId, rendered.text, {
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: rendered.keyboard },
        });
        return;
      }

      const cancelMatch = argsRaw.match(/^cancel\s+(\d+)$/i);
      if (cancelMatch) {
        const id = parseInt(cancelMatch[1], 10);
        if (Number.isNaN(id) || id <= 0) {
          await bot.sendMessage(chatId, i18n.t("invalid_format", { lng: lang }));
          return;
        }
        await DBService.cancelScheduledPost(chatId, id);
        await bot.sendMessage(chatId, i18n.t("bot_schedule_cancelled", { lng: lang }));
        return;
      }

      if (argsRaw.length > 0) {
        const parts = argsRaw.split(/\s+/);
        const firstToken = parts[0] || "";
        const timeMatch = firstToken.match(TIME_REGEX);
        if (timeMatch) {
          const h = parseInt(timeMatch[1], 10);
          const m = parseInt(timeMatch[2], 10);
          if (h < 0 || h > 23 || m < 0 || m > 59) {
            await bot.sendMessage(chatId, i18n.t("bot_invalid_time", { lng: lang }));
            return;
          }
          const body = parts.slice(1).join(" ").trim();
          const textContent = body || i18n.t("scheduled_post", { lng: lang });

          const canSchedule = await DBService.checkUserLimit(chatId, "scheduled");
          if (!canSchedule) {
            await bot.sendMessage(chatId, i18n.t("scheduling_limit_reached", { lng: lang }));
            return;
          }

          const scheduledDate = buildNextScheduleDate(h, m);
          await DBService.addScheduledPost(
            chatId,
            "text",
            { text: textContent, caption: textContent },
            scheduledDate.toISOString(),
          );

          const when = formatScheduleTime(scheduledDate.toISOString(), lang);
          const template = i18n.t("bot_schedule_saved_manual", { lng: lang });
          await bot.sendMessage(chatId, template.replace("{time}", when), { parse_mode: "HTML" });
          return;
        }
      }

      const helpText = [
        `📅 <b>${i18n.t("bot_schedule_command_title", { lng: lang })}</b>`,
        "",
        i18n.t("bot_schedule_command_help", { lng: lang }),
        "",
        "<b>Examples:</b>",
        "<code>/schedule 18:30</code> — bugungi 18:30 ga text post",
        "<code>/schedule 18:30 Yig'ilish eslatmasi</code>",
        "<code>/schedule list</code> — joriy postlar",
        "<code>/schedule cancel 12</code> — ID 12 ni bekor qilish",
        "",
        "<i>Tip: Reply to any message with the word <code>schedule</code> to schedule it for +1 hour.</i>",
      ].join("\n");

      const keyboard: InlineKeyboard = [
        [{ text: i18n.t("bot_schedule_btn_list", { lng: lang }), callback_data: "sched_list" }],
      ];
      await bot.sendMessage(chatId, helpText, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`schedule command error: ${msg}`);
      await bot.sendMessage(chatId, i18n.t("server_error", { lng: lang })).catch(() => {});
    }
  },
};
