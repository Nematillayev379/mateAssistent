import { getGrammyBot } from './grammy-instance';
import { InputFile } from 'grammy';

export const botCompat = {
  async sendMessage(chatId: number | string, text: string, options?: any) {
    return getGrammyBot().api.sendMessage(chatId, text, options);
  },

  async sendPhoto(chatId: number | string, photo: string | Buffer, options?: any) {
    const inputPhoto = Buffer.isBuffer(photo) ? new InputFile(photo) : photo;
    return getGrammyBot().api.sendPhoto(chatId, inputPhoto, options);
  },

  async sendVideo(chatId: number | string, video: string | Buffer, options?: any) {
    const inputVideo = Buffer.isBuffer(video) ? new InputFile(video) : video;
    return getGrammyBot().api.sendVideo(chatId, inputVideo, options);
  },

  async sendAudio(chatId: number | string, audio: string | Buffer, options?: any, fileOptions?: any) {
    const inputAudio = Buffer.isBuffer(audio) ? new InputFile(audio) : audio;
    const mergedOptions = { ...options, ...fileOptions };
    return getGrammyBot().api.sendAudio(chatId, inputAudio, mergedOptions);
  },

  async answerCallbackQuery(queryId: string, options?: any) {
    return getGrammyBot().api.answerCallbackQuery(queryId, options);
  },

  async editMessageText(text: string, options: any) {
    return getGrammyBot().api.editMessageText(options.chat_id, options.message_id, text, options);
  },

  async deleteMessage(chatId: number | string, messageId: number) {
    return getGrammyBot().api.deleteMessage(chatId, messageId);
  },

  async forwardMessage(targetChatId: number | string, fromChatId: number | string, messageId: number) {
    return getGrammyBot().api.forwardMessage(targetChatId, fromChatId, messageId);
  },

  async copyMessage(targetChatId: number | string, fromChatId: number | string, messageId: number) {
    return getGrammyBot().api.copyMessage(targetChatId, fromChatId, messageId);
  },

  async getMe() {
    return getGrammyBot().api.getMe();
  },

  async getChat(chatId: number | string) {
    return getGrammyBot().api.getChat(chatId);
  },

  async getChatMember(chatId: number | string, userId: number) {
    return getGrammyBot().api.getChatMember(chatId, userId);
  },

  async setMyCommands(commands: { command: string; description: string }[]) {
    return getGrammyBot().api.setMyCommands(commands);
  },

  async answerPreCheckoutQuery(queryId: string, ok: boolean, options?: any) {
    return getGrammyBot().api.answerPreCheckoutQuery(queryId, ok, options);
  },

  async createInvoiceLink(title: string, description: string, payload: string, providerToken: string, currency: string, prices: any[]) {
    return getGrammyBot().api.createInvoiceLink(title, description, payload, providerToken, currency, prices);
  },

  stopPolling() {
    // No-op: Grammy handles this internally
  },

  async processUpdate(update: any) {
    return getGrammyBot().handleUpdate(update);
  },
};
