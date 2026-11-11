// English translations
// โครงสร้างต้องตรงกับ th.ts · คีย์ไหนยังไม่มีที่นี่ ระบบจะใช้ภาษาไทยแทนให้เอง
import type { th } from './th';

type Deep<T> = { [K in keyof T]?: T[K] extends object ? Deep<T[K]> : string };

export const en: Deep<typeof th> = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    search: 'Search',
    refresh: 'Refresh',
    confirm: 'Confirm',
    back: 'Back',
    menu: 'Menu',
    loading: 'Loading…',
    language: 'Language',
  },
  login: {
    title: 'Sign in',
    enterPin: 'Enter your {{n}}-digit staff PIN',
    hint: 'Use the keypad below or your keyboard',
    dots: '{{filled}} of {{total}} digits entered',
    clear: 'Clear',
    clearKey: 'Clear',
    forgot: 'Forgot your PIN? Ask your store manager to set a new one.',
    backspace: 'Backspace',
  },
  nav: {
    sales: 'Sell',
    report: 'All reports',
    dashboard: 'Overview',
    salesReport: 'Sales report',
    billReport: 'Bill report',
    productReport: 'Product report',
    taxReport: 'About VAT',
    history: 'Sales history',
    shifts: 'Shifts',
    expenses: 'Expenses',
    promos: 'Promotions',
    staff: 'Staff',
    stockGroup: 'Stock',
    stock: 'Product list',
    skus: 'By attribute',
    shipGroup: 'Deliveries',
    shipments: 'New delivery note',
    shipmentReport: 'Delivery documents',
    branches: 'Branches',
    logs: 'LOG',
    settings: 'Settings',
    logout: 'Sign out',
  },
  role: {
    admin: 'Administrator',
    manager: 'Factory manager',
    sales: 'Sales staff',
    parttime: 'Sales staff (part-time)',
  },
};
