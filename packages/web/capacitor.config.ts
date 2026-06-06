// config de capacitor sobre el factory compartido de @platform/mobile.
// NOTA: el login de sis es oauth de spotify — en el webview requiere browser del
// sistema + deep link de vuelta (pendiente en el roadmap de la plataforma).
import { createCapacitorConfig } from '@platform/mobile';

export default createCapacitorConfig({
  appId: 'info.mier.sis',
  appName: 'SIS',
});
