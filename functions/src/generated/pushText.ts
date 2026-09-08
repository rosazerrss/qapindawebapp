/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Written by `scripts/generate-push-text.mjs` from the three dictionaries in
 * `src/i18n/translations`, which remain the only place these sentences are
 * written by a person. Run `npm run generate:push` — or any build, which does
 * it for you — after changing a notification's wording.
 *
 * It exists because a push banner is drawn by the operating system from text
 * the server sent: there is no page to look a translation key up in when the
 * phone has not opened Qapında for a week. `tests/pushText.test.ts` fails if
 * this file has fallen behind the dictionaries.
 */

export interface PushSentence {
  title: string;
  body: string;
}

export const PUSH_TEXT: Record<string, Record<string, PushSentence>> = {
  "az": {
    "NEW_ORDER_FOR_RESTAURANT": {
      "title": "Yeni sifariş",
      "body": "{{code}} — {{total}}"
    },
    "ORDER_CANCELLED": {
      "title": "Sifariş ləğv edildi",
      "body": "{{code}} nömrəli sifariş ləğv edildi."
    },
    "ORDER_ON_THE_WAY": {
      "title": "Sifarişiniz yoldadır",
      "body": "{{restaurant}} sifarişinizi göndərdi. Kuryer tezliklə qapınızda olacaq."
    },
    "REFUND_ISSUED": {
      "title": "Vəsait qaytarıldı",
      "body": "{{amount}} məbləği kartınıza qaytarılır. Bankdan asılı olaraq 1-5 iş günü çəkə bilər."
    },
    "SUPPORT_MESSAGE": {
      "title": "Dəstəkdən mesaj",
      "body": "{{restaurant}} — yeni mesaj var."
    },
    "SUPPORT_TICKET_UPDATED": {
      "title": "Müraciətiniz yeniləndi",
      "body": "{{subject}} — vəziyyət dəyişdi."
    },
    "COURIER_ASSIGNED": {
      "title": "Yeni çatdırılma",
      "body": "{{code}} — {{restaurant}} — {{address}}"
    },
    "COURIER_ORDER_READY": {
      "title": "Sifariş hazırdır",
      "body": "{{code}} — {{restaurant}} — {{address}}"
    },
    "COURIER_ORDER_CANCELLED": {
      "title": "Çatdırılma ləğv edildi",
      "body": "{{code}} — {{restaurant}} — bu ünvana getməyin. Səbəb: {{reason}}"
    },
    "OPS_RESTAURANT_OFFLINE": {
      "title": "Restoran iş saatında bağlıdır",
      "body": "{{restaurant}} — {{state}}"
    },
    "OPS_ORDER_PROBLEM": {
      "title": "Sifarişdə problem bildirildi",
      "body": "{{code}} — {{source}} — {{reason}}"
    }
  },
  "ru": {
    "NEW_ORDER_FOR_RESTAURANT": {
      "title": "Новый заказ",
      "body": "{{code}} — {{total}}"
    },
    "ORDER_CANCELLED": {
      "title": "Заказ отменён",
      "body": "Заказ {{code}} отменён."
    },
    "ORDER_ON_THE_WAY": {
      "title": "Заказ в пути",
      "body": "{{restaurant}} отправил ваш заказ. Курьер скоро будет у двери."
    },
    "REFUND_ISSUED": {
      "title": "Возврат средств",
      "body": "{{amount}} возвращается на вашу карту. В зависимости от банка это может занять 1–5 рабочих дней."
    },
    "SUPPORT_MESSAGE": {
      "title": "Сообщение от поддержки",
      "body": "{{restaurant}} — есть новое сообщение."
    },
    "SUPPORT_TICKET_UPDATED": {
      "title": "Ваше обращение обновлено",
      "body": "{{subject}} — статус изменился."
    },
    "COURIER_ASSIGNED": {
      "title": "Новая доставка",
      "body": "{{code}} — {{restaurant}} — {{address}}"
    },
    "COURIER_ORDER_READY": {
      "title": "Заказ готов",
      "body": "{{code}} — {{restaurant}} — {{address}}"
    },
    "COURIER_ORDER_CANCELLED": {
      "title": "Доставка отменена",
      "body": "{{code}} — {{restaurant}} — не ехать по этому адресу. Причина: {{reason}}"
    },
    "OPS_RESTAURANT_OFFLINE": {
      "title": "Ресторан закрыт в свои рабочие часы",
      "body": "{{restaurant}} — {{state}}"
    },
    "OPS_ORDER_PROBLEM": {
      "title": "Сообщили о проблеме",
      "body": "{{code}} — {{source}} — {{reason}}"
    }
  },
  "en": {
    "NEW_ORDER_FOR_RESTAURANT": {
      "title": "New order",
      "body": "{{code}} — {{total}}"
    },
    "ORDER_CANCELLED": {
      "title": "Order cancelled",
      "body": "Order {{code}} was cancelled."
    },
    "ORDER_ON_THE_WAY": {
      "title": "Your order is on its way",
      "body": "{{restaurant}} has sent your order. The courier will be at your door shortly."
    },
    "REFUND_ISSUED": {
      "title": "Refund issued",
      "body": "{{amount}} is being returned to your card. Depending on your bank this can take 1–5 working days."
    },
    "SUPPORT_MESSAGE": {
      "title": "Message from support",
      "body": "{{restaurant}} — there is a new message."
    },
    "SUPPORT_TICKET_UPDATED": {
      "title": "Your ticket was updated",
      "body": "{{subject}} — the status changed."
    },
    "COURIER_ASSIGNED": {
      "title": "New delivery",
      "body": "{{code}} — {{restaurant}} — {{address}}"
    },
    "COURIER_ORDER_READY": {
      "title": "Order is ready",
      "body": "{{code}} — {{restaurant}} — {{address}}"
    },
    "COURIER_ORDER_CANCELLED": {
      "title": "Delivery cancelled",
      "body": "{{code}} — {{restaurant}} — do not go to this address. Reason: {{reason}}"
    },
    "OPS_RESTAURANT_OFFLINE": {
      "title": "Restaurant closed during its own hours",
      "body": "{{restaurant}} — {{state}}"
    },
    "OPS_ORDER_PROBLEM": {
      "title": "A problem was reported",
      "body": "{{code}} — {{source}} — {{reason}}"
    }
  }
};
