import type {
  GenericTemplateElement,
  TemplateButton,
  QuickReplyItem,
} from "./types.js";

export function textPayload(text: string) {
  return { type: "text" as const, text };
}

export function imagePayload(url: string) {
  return { type: "image" as const, url };
}

export function templateElement(opts: {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  url?: string;
  buttons?: TemplateButton[];
}): GenericTemplateElement {
  const element: GenericTemplateElement = {
    title: opts.title,
    subtitle: opts.subtitle,
    image_url: opts.imageUrl,
    buttons: opts.buttons,
  };
  if (opts.url) {
    element.default_action = { type: "web_url", url: opts.url };
  }
  return element;
}

export function quickReply(title: string, payload: string): QuickReplyItem {
  return { content_type: "text", title, payload };
}

export function webUrlButton(title: string, url: string): TemplateButton {
  return { type: "web_url", title, url };
}

export function postbackButton(title: string, payload: string): TemplateButton {
  return { type: "postback", title, payload };
}
