package info.mier.sis;

import android.os.Build;
import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // android 15+ ya fuerza edge-to-edge; esto lo extiende a las versiones anteriores para
        // que todas se comporten igual (aviso de play "edge-to-edge may not display for all
        // users"). los insets los aplica como márgenes del webview el plugin de capawesome y
        // el color de las barras lo pinta observeSystemBars. va DESPUÉS de super.onCreate:
        // BridgeActivity cambia ahí del tema del splash al de la app, y llamarlo antes crearía
        // la decor view con el tema del splash. en 15+ NO se llama: su estilo `auto` activa el
        // scrim de contraste de la nav bar de tres botones (franja gris sobre el fondo) que hoy
        // no sale, y el edge-to-edge ya lo pone el sistema.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            EdgeToEdge.enable(this);
        } else {
            // con capacitor 8 la ventana llega con el scrim de contraste de la barra de navegación
            // encendido: en la de tres botones pintaba una franja gris (#303030 al 80%) sobre el
            // fondo que la 7 no tenía (medido en el emulador api 36). el color de debajo ya lo pinta
            // capawesome (observeSystemBars), así que se apaga.
            getWindow().setNavigationBarContrastEnforced(false);
        }
    }
}
