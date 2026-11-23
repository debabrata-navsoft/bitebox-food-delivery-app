/** Help center topics and their questions. Answers stay general: the order page has the specifics. */
export interface HelpTopic {
  id: string;
  title: string;
  icon: string;
  faqs: { q: string; a: string }[];
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'orders',
    title: 'Orders & tracking',
    icon: 'package',
    faqs: [
      {
        q: 'Where is my order?',
        a: 'Open My orders and pick the order. Once a rider picks it up you can follow them live on the map, with an estimated arrival time.',
      },
      {
        q: 'Can I cancel my order?',
        a: 'Yes, until the restaurant accepts it: open the order and choose Cancel. After that the kitchen has started, so please chat with us and we will help.',
      },
      {
        q: 'An item is missing or wrong. What do I do?',
        a: 'Open the order and choose Get help, or start a chat with support. Mention the order number and what was missing, and we will sort it out.',
      },
    ],
  },
  {
    id: 'payments',
    title: 'Payments & refunds',
    icon: 'credit-card',
    faqs: [
      {
        q: 'Which payment methods can I use?',
        a: 'UPI, cards, net banking, wallets and cash on delivery, where the restaurant accepts it. You choose when you place the order.',
      },
      {
        q: 'When will I get my refund?',
        a: 'Refunds go back to the method you paid with. We start them straight away; banks usually take 5 to 7 working days to show them.',
      },
      {
        q: 'Money was taken but the order failed.',
        a: 'If a payment does not complete, the amount is returned automatically by your bank or the payment provider. If it has not arrived in 7 working days, chat with us.',
      },
    ],
  },
  {
    id: 'delivery',
    title: 'Delivery',
    icon: 'bike',
    faqs: [
      {
        q: 'How is the delivery fee worked out?',
        a: 'It depends on the distance from the restaurant to your address. You always see the fee in the bill before you pay.',
      },
      {
        q: 'Can I change my delivery address?',
        a: 'Choose the address at checkout. After the order is placed the address cannot be changed, so please check it first.',
      },
    ],
  },
  {
    id: 'offers',
    title: 'Offers & coins',
    icon: 'ticket-percent',
    faqs: [
      {
        q: 'Why can’t I apply a coupon?',
        a: 'Each coupon has its own rules, such as a minimum order, certain restaurants or dishes, or new customers only. The coupon card shows what is missing.',
      },
      {
        q: 'How do BiteBox coins work?',
        a: 'You earn coins on delivered orders and some activities, and can use them to pay for part of a later order. Coins expire after a while; see Rewards for your balance.',
      },
    ],
  },
  {
    id: 'account',
    title: 'Account',
    icon: 'user-round',
    faqs: [
      {
        q: 'How do I change my phone number or email?',
        a: 'Go to Profile. You can update your details there and verify your number or email with a one-time code.',
      },
      {
        q: 'I forgot my password.',
        a: 'Choose Forgot password on the sign-in page and we will email you a link to set a new one. You can also sign in with a code sent to your phone.',
      },
    ],
  },
  {
    id: 'partners',
    title: 'Restaurants & riders',
    icon: 'store',
    faqs: [
      {
        q: 'How do I list my restaurant on BiteBox?',
        a: 'Register your restaurant, add your documents and bank details, and our team will review it. You can start taking orders once it is approved.',
      },
      {
        q: 'How do I become a delivery partner?',
        a: 'Sign up as a rider, upload your documents, and go online once you are verified. You can choose when you work.',
      },
    ],
  },
];
