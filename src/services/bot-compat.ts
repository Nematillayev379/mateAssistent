// Compatibility wrapper - allows existing code to work with grammy underneath
import { grammyBot } from './grammy-bot';
import { InputFile } from 'grammy';

export const botCompat = {
  async sendMessage(chatId: number | string, text: string, options?: any) {
    return grammyBot.api.sendMessage(chatId, text, options);
  },
  async sendPhoto(chatId: number | string, photo: string | Buffer, options?: any) {
    const inputPhoto = Buffer.isBuffer(photo) ? new InputFile(photo) : photo;
    return grammyBot.api.sendPhoto(chatId, inputPhoto, options);
  },
  async sendVideo(chatId: number | string, video: string | Buffer, options?: any) {
    const inputVideo = Buffer.isBuffer(video) ? new InputFile(video) : video;
    return grammyBot.api.sendVideo(chatId, inputVideo, options);
  },
  async sendAudio(chatId: number | string, audio: string | Buffer, options?: any, fileOptions?: any) {
    const inputAudio = Buffer.isBuffer(audio) ? new InputFile(audio) : audio;
    return grammyBot.api.sendAudio(chatId, inputAudio, options);
  },
  async editMessageText(text: string, options: any) {
    return grammyBot.api.editMessageText(options.chat_id, options.message_id, text, options);
  },
  async deleteMessage(chatId: number | string, messageId: number) {
    return grammyBot.api.deleteMessage(chatId, messageId);
  },
  async answerCallbackQuery(callbackQueryId: string, options?: any) {
    return grammyBot.api.answerCallbackQuery(callbackQueryId, options);
  },
  async getMe() {
    return grammyBot.api.getMe();
  },
  async setWebHook(url: string, options?: any) {
    return grammyBot.api.setWebhook(url, options);
  },
  async deleteWebHook() {
    return grammyBot.api.deleteWebhook();
  },
  async getWebHookInfo() {
    return grammyBot.api.getWebhookInfo();
  },
  async setMyCommands(commands: any[], options?: any) {
    return grammyBot.api.setMyCommands(commands, options);
  },
  async copyMessage(chatId: number | string, fromChatId: number | string, messageId: number, options?: any) {
    return grammyBot.api.copyMessage(chatId, fromChatId, messageId, options);
  },
  async forwardMessage(chatId: number | string, fromChatId: number | string, messageId: number, options?: any) {
    return grammyBot.api.forwardMessage(chatId, fromChatId, messageId, options);
  },
  async getChat(chatId: number | string) {
    return grammyBot.api.getChat(chatId);
  },
  async getChatMember(chatId: number | string, userId: number) {
    return grammyBot.api.getChatMember(chatId, userId);
  },
  async answerPreCheckoutQuery(preCheckoutQueryId: string, ok: boolean, options?: any) {
    return grammyBot.api.answerPreCheckoutQuery(preCheckoutQueryId, ok, options);
  },
  async processUpdate(update: any) {
    return grammyBot.handleUpdate(update);
  },
  stopPolling() {
    grammyBot.stop();
  },
  startPolling() {
    return grammyBot.start();
  },
  isPolling() {
    return false; // grammy handles this internally
  },
  on(event: string, handler: any) {
    // Grammy uses different event system, this is a no-op for compatibility
    // grammy handlers are registered directly in grammy-bot.ts
  },
  onText(pattern: RegExp, handler: any) {
    // Grammy uses command middleware instead of onText
    // This is a no-op for compatibility
  },
};
