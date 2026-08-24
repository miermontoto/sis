// tipos de eventos de notificación push
// - record: una entidad entra por primera vez al top-10 de una categoría de records
// - number_one: nuevo número 1 en el chart semanal recién cerrado
// - chart_closing: recap del top-N del chart semanal recién cerrado
// - playlist_regenerated: una playlist generada se auto-regeneró en segundo plano
// - release_anniversary: un álbum/single escuchado cumple años desde su publicación
// - first_listen_anniversary: aniversario de la primera escucha de un artista
// - milestone: una entidad cruza un umbral de reproducciones (100, 250, 500, 1k...)
export type NotificationType =
  | 'record'
  | 'number_one'
  | 'chart_closing'
  | 'playlist_regenerated'
  | 'release_anniversary'
  | 'first_listen_anniversary'
  | 'milestone';

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
  notifyAnniversaries: boolean;
  notifyMilestones: boolean;
}
