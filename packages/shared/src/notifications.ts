// tipos de eventos de notificación push (4 categorías en fase 1)
// - record: una entidad entra por primera vez al top-10 de una categoría de records
// - number_one: nuevo número 1 en el chart semanal recién cerrado
// - chart_closing: recap del top-N del chart semanal recién cerrado
// - biggest_debut: mejor debut (isNew) del chart semanal recién cerrado
export type NotificationType = 'record' | 'number_one' | 'chart_closing' | 'biggest_debut';

// plataformas soportadas para el registro de tokens de dispositivo
export type DevicePlatform = 'android' | 'ios' | 'web';

// payload enviado al dispositivo (FCM / web push). data lleva metadata para
// que el cliente pueda navegar a la ruta relevante al abrir la notificación.
export interface PushPayload {
  title: string;
  body: string;
  data: {
    type: NotificationType;
    route?: string;
    entityType?: string;
    entityId?: string;
    period?: string;
  };
}

// representación pública de un token registrado (sin exponer el token en sí)
export interface DeviceTokenRecord {
  id: number;
  platform: DevicePlatform;
  createdAt: string;
}

// preferencias de notificaciones del usuario (master switch + por tipo)
export interface NotificationPreferences {
  notificationsEnabled: boolean;
  notifyRecords: boolean;
  notifyNumberOne: boolean;
  notifyChartClosings: boolean;
  notifyBiggestDebut: boolean;
}
