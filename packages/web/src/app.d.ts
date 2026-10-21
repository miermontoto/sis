// tipos globales de sveltekit
declare global {
  namespace App {
    // shallow routing (pushState): la hoja de now playing del móvil vive en el
    // historial, así que el botón atrás (también el de android) la cierra
    interface PageState {
      nowPlayingSheet?: 'player' | 'session';
    }
  }
}

export {};
