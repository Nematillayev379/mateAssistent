export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  caption?: string;
  entities?: TgMessageEntity[];
  caption_entities?: TgMessageEntity[];
  reply_to_message?: TgMessage;
  successful_payment?: {
    invoice_payload: string;
    total_amount: number;
    currency: string;
  };
  photo?: any[];
  document?: any;
  date: number;
}

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface TgChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
}

export interface TgMessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
}

export interface TgPreCheckoutQuery {
  id: string;
  from: TgUser;
  invoice_payload: string;
  currency: string;
  total_amount: number;
}

export type InlineKeyboard = TgInlineKeyboardButton[][];
