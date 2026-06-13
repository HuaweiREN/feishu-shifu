import type { CardAction } from "../types.js";

export function buildResultCard(params: { title: string; body: string; actions?: CardAction[] }) {
  return {
    config: {
      wide_screen_mode: true
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: params.body
        }
      },
      ...(params.actions?.length
        ? [
            {
              tag: "action",
              actions: params.actions.map((action) => ({
                tag: "button",
                text: {
                  tag: "plain_text",
                  content: action.text
                },
                url: action.url,
                type: "default"
              }))
            }
          ]
        : [])
    ],
    header: {
      title: {
        tag: "plain_text",
        content: params.title
      },
      template: "blue"
    }
  };
}
