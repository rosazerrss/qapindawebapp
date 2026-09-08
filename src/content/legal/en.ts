import type { LegalDocuments } from './types';

/** English translation of the Azerbaijani source texts in `az.ts`. */
export const LEGAL_EN: LegalDocuments = {
  terms: {
    title: 'Terms of Use',
    intro:
      'This document explains how the Qapında platform works: who is responsible for what, how an order is placed, and what to do if something goes wrong. It is written in plain language, because the person reading it is not a lawyer — it is somebody ordering food.',
    version: 'Version 1.0',
    effectiveDate: 'Effective date: 1 September 2026',
    sections: [
      {
        heading: '1. Who we are and what we are not',
        body: [
          'Qapında is an online platform that connects restaurants and customers. The platform is operated by {{OPERATOR_LEGAL_NAME}} (tax ID / VÖEN: {{OPERATOR_TAX_ID}}, address: {{OPERATOR_ADDRESS}}).',
          'We are not a restaurant. We do not cook the food, we do not write the menu, and we do not set the prices.',
          'We are not a courier company. We have no couriers of our own. Your order is delivered by the restaurant’s own courier.',
          'Our job is the platform itself: showing restaurant menus, passing your order to the restaurant, letting you follow its status, and providing support.',
        ],
      },
      {
        heading: '2. Who these terms apply to',
        body: [
          'These terms apply to everyone who uses the Qapında website or app — even if you are only browsing menus.',
          'By creating an account or placing an order you accept these terms. If you do not agree with them, please do not use the platform.',
          'Our relationship with restaurants is governed by a separate partner agreement; this document is for customers.',
        ],
      },
      {
        heading: '3. Account and sign-in',
        body: [
          'You must be 18 or older to place an order.',
          'One person, one account. A phone number and an email address can each be linked to only one account.',
          'You sign in with your phone number (SMS code) or with a Google account. There is no password — so there is no password to steal.',
          'Never give your SMS code to anyone: not to someone calling in our name, not to the restaurant, not to the courier. We never ask you for your SMS code.',
          'You are responsible for orders placed from your account. If you lose your phone or pass your number to somebody else, tell us.',
          'Keeping your name, phone number and address correct is your responsibility. A restaurant is not responsible for an order sent to a wrong address you entered.',
        ],
      },
      {
        heading: '4. Placing an order and when the contract forms',
        body: [
          'Menu items are an offer to sell, not a guarantee. The restaurant marks what is actually available.',
          'When you send an order, you are making an offer to the restaurant. No contract exists yet at that moment.',
          'The contract of sale is formed when the restaurant accepts your order. That contract is between you and the restaurant. Qapında is not a party to it.',
          'A restaurant may decline an order — for example if a dish has run out, the address is too far, or the restaurant is about to close. In that case you are charged nothing.',
          'Qapında acts as an intermediary and charges the restaurant a commission for this service. The commission is paid by the restaurant; no separate platform fee is taken from you.',
        ],
      },
      {
        heading: '5. Prices, delivery fee and minimum order',
        body: [
          'Prices are set by the restaurant. Menu prices are shown in manats.',
          'Each restaurant may have its own delivery fee and its own minimum order value. Both are shown in the basket before you confirm.',
          'The total is calculated and locked at the moment you send the order. If the restaurant changes its menu prices later, that does not affect an order already placed.',
          'Occasionally a menu may contain an obvious technical error, such as a clearly wrong price. In that case the restaurant may refuse the order and you pay nothing.',
        ],
      },
      {
        heading: '6. Payment at the door',
        body: [
          'Payment is made at the door only: cash, or card on the courier’s terminal.',
          'There is no online payment on the platform yet. Qapında does not take money from you and never sees, processes or stores your card details. If a site or app asks you for a card number in our name, it is a scam — tell us immediately.',
          'You hand the money to the restaurant or its courier. You are entitled to ask for a receipt.',
          'Carrying change is the restaurant’s job, but if you plan to pay with a large note, adding a comment to the order makes life easier for everyone.',
        ],
      },
      {
        heading: '7. Cancelling and refusing an order',
        body: [
          'Before the restaurant accepts the order, you can cancel it in the app free of charge.',
          'Once the restaurant accepts, cooking starts. From that point cancellation needs the restaurant’s agreement — contact us or the restaurant directly.',
          'The restaurant may also cancel an accepted order if there is a genuine reason: ingredients ran out, no courier is available, the address is outside the delivery zone. You are told the reason.',
          'Refusing food at the door without a good reason causes the restaurant a real loss. Repeated cases may lead to a review of your account.',
          'If the food never arrived, the wrong food arrived, or it arrived in an unusable state, you may refuse to pay or ask for your money back. That claim is against the restaurant; we help you pursue it.',
        ],
      },
      {
        heading: '8. Complaints and who is responsible for what',
        body: [
          'The restaurant is responsible for: food quality and ingredients, allergens, packaging, cooking and delivery time, the courier’s conduct, and whether the order arrived complete.',
          'Qapında is responsible for: the platform working, passing your order to the restaurant correctly, protecting your data, support, and mediating between you and the restaurant.',
          'A problem with the food or the delivery is usually solved fastest with the restaurant. If you get no answer, write to {{SUPPORT_EMAIL}} or call {{SUPPORT_PHONE}} and give your order number.',
          'We record your complaint, ask the restaurant to explain, and tell you the outcome. If complaints about a restaurant pile up, we reconsider its place on the platform.',
          'These terms do not limit the rights the law gives you as a consumer.',
        ],
      },
      {
        heading: '9. Reviews',
        body: [
          'Only someone who actually received that order can write a review of it. A person who never ordered cannot leave a review.',
          'Your full name is not shown in a review. Other users see a shortened form — for example “Aysel M.”.',
          'A review must be truthful and based on your own experience. Insults, swearing, other people’s personal data, advertising, and text written in someone else’s name are not allowed.',
          'A review that breaks the rules is hidden by a moderator, and the reason is recorded in the system. We do not delete reviews silently.',
          'A restaurant cannot delete or hide a review about itself. Only a moderator can, and only with a recorded reason.',
          'A negative but truthful and civil review is not removed. Such reviews are useful both to the restaurant and to other customers.',
        ],
      },
      {
        heading: '10. Coupons and discounts',
        body: [
          'Coupon limits are counted per person, not per account — phone number, device and delivery address are taken into account.',
          'Creating extra accounts to get new coupons is not allowed.',
          'If abuse is detected, the coupon is cancelled, the discount is reversed, and the account may be sent for review.',
          'The conditions of a coupon (minimum value, validity period, which restaurants it covers) are stated on the coupon itself.',
        ],
      },
      {
        heading: '11. Prohibited use',
        body: [
          'Ordering under a false name, with someone else’s phone number, or to an invented address.',
          'Creating multiple accounts, or gaming the coupon or rating systems.',
          'Insulting, threatening or discriminating against restaurants, couriers or support staff.',
          'Loading the platform with automated tools, scraping data in bulk, probing our security, or trying to disrupt the system.',
          'Using the platform for any unlawful purpose.',
        ],
      },
      {
        heading: '12. Suspending an account',
        body: [
          'If these terms are broken, we may suspend or close an account.',
          'We tell you the reason for a suspension and give you a chance to explain. If you think it is a mistake, write to support — the decision is reviewed.',
          'In serious cases (fraud, threats, attacks on our security) we may suspend an account without prior warning.',
          'You can close your account yourself at any time. Order and financial records stay, in anonymised form, for as long as the law requires — this is explained in the Privacy Notice.',
        ],
      },
      {
        heading: '13. Changes to these terms',
        body: [
          'We update these terms from time to time. The version number and effective date are shown at the top of this page.',
          'We announce significant changes in advance through the app.',
          'If you keep using the platform after a change, you are taken to have accepted the new version. If you do not agree, you can close your account.',
        ],
      },
      {
        heading: '14. Limits of our liability',
        body: [
          'We do not promise that the platform will run without interruption. Internet, server or restaurant-side problems happen. We fix such outages as quickly as we can.',
          'Food quality and ingredients, delivery time and the courier’s conduct are the restaurant’s direct responsibility, because the restaurant is the one doing that work.',
          'For our own mistakes — for example if we pass your order to the restaurant incorrectly — we take responsibility.',
          'This section does not apply where the law does not allow liability to be excluded, including intent, gross negligence, and harm to life or health. We are not denying responsibility across the board — we are stating honestly who is answerable for what.',
        ],
      },
      {
        heading: '15. Governing law and disputes',
        body: [
          'These terms are governed by the law of the Republic of Azerbaijan.',
          'We try to settle any dispute by talking first, and we reply to your complaint within a reasonable time.',
          'If no agreement is reached, the dispute is heard by the competent courts of the Republic of Azerbaijan. The rights of recourse the law gives you as a consumer remain unaffected.',
        ],
      },
      {
        heading: '16. Contact',
        body: [
          'Email: {{SUPPORT_EMAIL}}',
          'Phone: {{SUPPORT_PHONE}}',
          'Operator: {{OPERATOR_LEGAL_NAME}}, address: {{OPERATOR_ADDRESS}}, tax ID / VÖEN: {{OPERATOR_TAX_ID}}',
        ],
      },
    ],
  },

  privacy: {
    title: 'Privacy Notice',
    intro:
      'This notice explains what data we collect, why we collect it, who we share it with, and what rights you have over it. We do not sell your data.',
    version: 'Version 1.0',
    effectiveDate: 'Effective date: 1 September 2026',
    sections: [
      {
        heading: '1. In short',
        body: [
          'We collect what is needed to get your order to you: your name, phone number, address and the order itself.',
          'We share that only with the restaurant that has to deliver your order — with no other restaurant.',
          'We never see your card details, because payment happens at the door.',
          'The data controller is {{OPERATOR_LEGAL_NAME}} (address: {{OPERATOR_ADDRESS}}).',
        ],
      },
      {
        heading: '2. What we collect',
        body: [
          'Account data: first and last name, phone number, email address (if you signed in with Google or added one yourself).',
          'Delivery addresses: the address text you write, flat number and notes, and the map coordinates you choose yourself.',
          'Order history: what you ordered, from which restaurant, for how much, when, the order status, and the cancellation reason if there was one.',
          'Your reviews and ratings.',
          'Device identifiers: a technical identifier used to detect coupon and discount abuse.',
          'Usage logs: IP address, browser and device type, which pages you opened, error reports.',
          'The content of the messages you send to support.',
          'There is no hidden collection: we do not listen to your microphone and we do not read your contacts or photo gallery. Your location is used only when you place a pin on the map yourself or tap “find me”.',
        ],
      },
      {
        heading: '3. Why we collect it, and on what legal basis',
        body: [
          'To perform the contract: to take your order, pass it to the restaurant, get it delivered, show you its status and support you. Without this data an order is not possible.',
          'To meet legal obligations: keeping financial, tax and accounting records.',
          'For our legitimate interests: preventing fraud and coupon abuse, keeping the platform secure, finding bugs and improving the service. We weigh that interest against your rights.',
          'With your consent: marketing messages and statistics cookies. You can withdraw consent at any time; it does not affect your ability to order.',
        ],
      },
      {
        heading: '4. Who we share it with',
        body: [
          'The restaurant you ordered from: your name, phone number, delivery address and the contents of the order. The restaurant needs these to cook the food and bring it to your door.',
          'A restaurant sees only its own orders. It does not see other restaurants’ customers, your other orders, or your email address.',
          'Our technical providers: hosting, database, SMS delivery and error monitoring. They process data only on our instructions and may not use it for their own purposes.',
          'Public authorities — only where the law requires it, and only to the extent required.',
          'Nobody else. We do not sell your data and we do not hand it to advertising brokers.',
        ],
      },
      {
        heading: '5. Card and payment data',
        body: [
          'There is no online payment on the platform. Payment is made at the door, in cash or by card.',
          'We do not see, process or store your card number, CVV or bank details.',
          'We record only the payment method (cash or card) and the order total — needed for accounting and for resolving disputes.',
        ],
      },
      {
        heading: '6. How your name appears',
        body: [
          'Your full legal name is never shown publicly.',
          'Reviews show a shortened form of your name — for example “Aysel M.”.',
          'Your full name is seen only by the restaurant delivering your order and, where necessary, by our support staff.',
        ],
      },
      {
        heading: '7. How long we keep it',
        body: [
          'Account data is kept while your account is active.',
          'Order and financial records are kept for as long as the law requires. That period is set by accounting and tax law, not by our preference.',
          'When you close your account, your personal data is not deleted but anonymised: name, phone, email and address are stripped from the records, and the order remains only as an amount, a date and a restaurant. You cannot be identified from what is left.',
          'We do it this way because the law requires the financial record to be kept, but does not require your name to stay in it.',
          'Usage logs are kept for a short time — normally a few months, unless a security incident is being investigated.',
        ],
      },
      {
        heading: '8. Your rights',
        body: [
          'You have the right to get a copy of your data — download it under “My account”, or ask us for it.',
          'You have the right to correct wrong data. You can edit your name, phone number and addresses yourself.',
          'You have the right to erasure. When you close your account the data is anonymised as described above; records the law requires us to keep remain in anonymised form.',
          'You have the right to object to processing and to withdraw consent — in particular for marketing and statistics.',
          'To use these rights, write to {{SUPPORT_EMAIL}}. We will verify your identity and reply within a reasonable time, and no later than one month. This is free of charge.',
          'If you are not satisfied with our answer, you may complain to the competent personal data protection authority of the Republic of Azerbaijan.',
        ],
      },
      {
        heading: '9. Cookies and similar technologies',
        body: [
          'Essential cookies keep your session, your language choice and your basket. The site does not work without them.',
          'Statistics cookies are set only with your consent.',
          'The device identifier is used to detect coupon abuse and is not used for advertising.',
          'Details are in the Cookie Notice.',
        ],
      },
      {
        heading: '10. Children',
        body: [
          'The platform is not intended for anyone under 18, and we do not knowingly collect their data.',
          'If you believe we hold a child’s data, write to {{SUPPORT_EMAIL}} and we will check and delete it.',
        ],
      },
      {
        heading: '11. Security',
        body: [
          'Data travels over an encrypted connection.',
          'Access to data is limited by role: each member of staff sees only what their work requires.',
          'Administrator actions are written to an audit log.',
          'No system is completely secure. If a serious incident affects your data, we will notify you and the competent authority in the way the law requires.',
        ],
      },
      {
        heading: '12. Changes and contact',
        body: [
          'We may update this notice. The version number and date are shown at the top; significant changes are announced separately.',
          'Questions: {{SUPPORT_EMAIL}}, {{SUPPORT_PHONE}}.',
        ],
      },
    ],
  },

  cookies: {
    title: 'Cookie Notice',
    intro:
      'A short notice: what we store in your browser and why. We do not use advertising cookies.',
    version: 'Version 1.0',
    effectiveDate: 'Effective date: 1 September 2026',
    sections: [
      {
        heading: '1. Essential cookies',
        body: [
          'They remember that you are signed in, your language, the region you chose, and your basket.',
          'The site does not work without them, so no consent is asked for these.',
        ],
      },
      {
        heading: '2. Statistics cookies',
        body: [
          'They help us see which pages work and where errors happen.',
          'They are set only with your consent. If you choose “essential only”, they are never written.',
        ],
      },
      {
        heading: '3. Advertising cookies',
        body: [
          'We do not use them. We do not track you across other sites and we do not pass your data to ad networks.',
        ],
      },
      {
        heading: '4. Changing your choice',
        body: [
          'Clear this site’s data in your browser settings and the choice dialog appears again, so you can choose differently.',
          'If you block essential cookies, sign-in and the basket will not work.',
        ],
      },
      {
        heading: '5. Contact',
        body: ['Questions: {{SUPPORT_EMAIL}}'],
      },
    ],
  },
};
