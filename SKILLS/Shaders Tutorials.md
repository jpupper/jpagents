

Here goes examples from 0 to hero for learning how to write shaders. The code has comments in spanish.



#version 150 //Debemos dejar seteada la version en 150.

//Taller de Livecoding con visuales en GLSL

//1.1
//Estructura del lenguaje inicial.
//funcion main, vec4 , como poner un color inicial.


//Este es el render de salida, 
//en kodelife tiene que setearse de esta manera 
out vec4 fragColor; 
void main(void)
{
    // vec4 es un tipo de variable que almacena 4 valores simultaneamente.
    //Estos son Red, Green, Blue y Alpha (rojo,verde,azul y alpha).
    //En este caso no usaremos el alpha por ahora. 
    
    
    //Segun el valor de 0 a 1 que tenga cada variable del vec4. Sera la cantidad de ese color que tenga. 
        
    //Si descomentamos las siguientes lineas veremos solo ese color. 
    
    //fragColor = vec4(0.0,0.0,0.0,1.0); //BLACK |NEGRO
    //fragColor = vec4(1.0,0.0,0.0,1.0); //RED   |ROJO 
    //fragColor = vec4(0.0,1.0,0.0,1.0); //GREEN |VERDE
    //fragColor = vec4(0.0,0.0,1.0,1.0); //BLUE  |AZUL  
    //fragColor = vec4(1.0,1.0,0.0,1.0); //YELLOW|AMARILLO 
    //fragColor = vec4(1.0,0.0,1.0,1.0); //PINK  |MAGENTA 
    //fragColor = vec4(0.0,1.0,1.0,1.0); //CYAN  |CELESTE 
    //fragColor = vec4(1.0,1.0,1.0,1.0); //WHITE |BLANCO
    
    
    //tambien puedo definir variables que : 
    
    fragColor = vec4(1.0,0.5,0.0,1.0); //NARANJA
    
    
}


#version 150 //Debemos dejar seteada la version en 150.


//Taller de Livecoding con visuales en GLSL
//1.2
//Estructura del lenguaje inicial parte 2 
//Intro a creacion de variables.



//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;


//Declaramos el render de salida
out vec4 fragColor; 
void main(void)
{
    
    //También podemos definir nuestras propias variables para colocar          //dentro del vec4 final.
    
    //Ejemplo 1 : 
    //descomentar codigo : 
    float red = 0.9;   //Cantidad de rojo 
    float green = 0.3; //Cantidad de verde.
    float blue = 0.3;  //Cantidad de azul.  
    //fragColor = vec4(red,green,blue,1.0); 
    
    //Ejemplo 2 : 
    //Tambien podemos definir una variable vec3 y luego meterla dentro del vec4 obligatorio final : 
    //usemos float , vec2 , vec3 o vec4 las variables son siempre intercambiables.
    vec3 color = vec3(0.2,0.5,0.4); 
    //fragColor = vec4(color,1.0); 
    
    
    //Ejemplo 3 : 
    //También podemos obtener un valor especifico de un vector utilizando el nombre del vector + .r
    //.r obtiene el primer valor del vector.
    //.g obtiene el segundo valor del vector.
    //.b obtiene el tercer valor del vector.
    //.a obtiene el cuarto valor del vector.
    
    //EN ESTE CASO ESTAMOS colocando en el valor R del fragcolor, el valor G de color 2. 
    //De esta manera nosotros podemos decidir que valores entran en que lugar.
    fragColor = vec4(color.b,color.g,color.r,1.0); 
    
    //Ejemplo 4 : 
    //Otra manera de obtener los valores individuales de los vectores es utilizando xyzw en vez de rgba
    //Se suele utilizar xyz cuando nuestros vectores representan puntos en el espacio y no valores de colores.
    fragColor = vec4(color.x,color.y,color.z,1.0); 
    
    //Ejemplo 5 : 
    //Otra manera de obtener los valores individuales de los vectores es utilizando los vectores como si 
    //estuvieramos pasandole el indice al array.
    fragColor = vec4(color[0],color[1],color[2],1.0); 
    
    
    
}

#version 150 //Debemos dejar seteada la version en 150.


//Taller de Livecoding con visuales en GLSL 1.3
//1.3
//Estructura del lenguaje inicial parte 3
//Creacion y definición de funciones. 
 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;


//Declaramos el render de salida
out vec4 fragColor; 


//LAS FUNCIONES SIEMPRE SE DECLARAN ARRIBA DEL MAIN.

//Podemos declarar funciones que proximamente vamos a invocar en el main.


//Las funciones pueden devolver variables : 
//Es decir, cuando yo ejecuto esta funcion, la funcion va a devolver un valor, en este caso, el valor que devuelve es el vec3.
//Hago una funcion que me devuelve un valor
vec3 rojopastel(){
    return vec3(0.9,0.55,0.55);
}

//Esta funcion recibe un valor, y utiliza ese valor para devolver otro valor. 
//En este caso, esta función lo que hace es obtener el valor invertido de un vec3.
vec3 invertcolor(vec3 _col1){
    return vec3(1.0-_col1);
}

void main(void)
{
    vec3 colorfinal = rojopastel();
    //fragColor = vec4(colorfinal,1.0); 
    fragColor =  vec4(invertcolor(colorfinal),1.0); 
    
}

#version 150 //Debemos dejar seteada la version en 150.


//Taller de Livecoding con visuales en GLSL
//1.4
//Estructura del lenguaje inicial parte 4
//Coordenadas cartesianas.
 
uniform float time;
uniform vec2 resolution;

out vec4 fragColor; 
void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution; // De esta manera obtenemos las coordenadas cartesianas
    //La variable uv tendra en su componente X (es decir el primer componente del vector).
    //                       y su componente Y (es decir el segundo componente del vector).
       
    // vec3 color = vec3(uv.y,0.0,0.0); // De mas brillante a menos brillante en Y segun el valor del pixel  
    //vec3 color = vec3(0.0,uv.x,0.0); // De mas brillante a menos brillante en X segun el valor del pixel  
    vec3 color = vec3(uv.x,0.2,uv.y); // De mas brillante a menos brillante en X e Y segun el valor del pixel  
    //vec3 color = vec3(1.-uv.x,0.0,0.0); // Invertimos la coordenada en X 
    //vec3 color = vec3(1.-uv.y,1.-uv.y,0.0); // Invertimos la coordenada en Y
    //vec3 color = vec3(uv,0.8); //Aca directamente mandamos las UV (un vec2 y sumamos otro numero mas para así tener las 3 componentes).
    fragColor = vec4(color,1.0); 
    
}

#version 150 //Debemos dejar seteada la version en 150.


//Taller de Livecoding con visuales en GLSL
//1.4
//Estructura del lenguaje inicial parte 4
//Variables uniform
 
uniform float time;
uniform vec2 resolution;

//PUEDO DEFINIR MIS PROPIAS UNIFORM y asignarlas a lo que yo quiera ! !!

//La interacción con las uniform dependen del software que estemos manejando.
//En kodelife las variables uniform se definen desde la interfaz

//defino una variable uniform : 
uniform float rojo; //A LA DERECHA ESTA EL SLIDER QUE DICE ROJO. SI LO MOVEMOS PODEMOS CAMBIAR EL VALOR DEL UNIFORM
uniform vec2 mouse;

out vec4 fragColor; 
void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution; // De esta manera obtenemos las coordenadas cartesianas
 
 
 
 
 

    // Para que funcione el mouse es necesario ocultar el codigo y apretar en la pantalla(asi es en kodelife).
    
    vec3 color = vec3(rojo,mouse.x,mouse.y); 

    fragColor = vec4(color,1.0); 
    
}



#version 150 //Debemos dejar seteada la version en 150.

//2.1
//Uso de la funcion sin para generar ondas
//Taller de Livecoding con visuales en GLSL 


uniform float time;
uniform vec2 resolution;


//Este es el render de salida, 
//en kodelife tiene que setearse de esta manera 
out vec4 fragColor; 
void main(void)
{   

    vec2 uv = gl_FragCoord.xy / resolution; //Obtengo las coordenadas UV(coordenadas cartesianas.
   
    //La funcion sin (seno) me sirve para crear osciladores.
    //devuelve un valor entre -1 y 1. 
    //Entonces para que oscile constantemente debo multiplicarla por 0.5. 
    //una vez multiplicada devolvera un valor entre -0.5+0.5. 
    //Si a ese resultado le sumo 0.5.
    //Obtengo que va a ir entre 0 y 1.
    
    //Utilizo time para que mi onda sinusoide suba y baje constantemente. De esta manera le doy movimiento.
    
    float forma = sin(time)*0.5+0.5;
     
    fragColor = vec4(vec3(forma),1.0); 

}


#version 150 //Debemos dejar seteada la version en 150.

//2.2
//Intro senoidales
//Taller de Livecoding con visuales en GLSL 


uniform float time;
uniform vec2 resolution;



out vec4 fragColor; 
void main(void)
{   

    vec2 uv = gl_FragCoord.xy / resolution; //Obtengo las coordenadas UV(coordenadas cartesianas.
   
    //Si a la función senoidal le sumamos una variable. veremos que oscilara en relación en esa variable. 
    
    float forma = sin(time+uv.x)*0.5+0.5; //Degrade constante en X
          forma = sin(time+uv.y)*0.5+0.5; //Degrade constante en Y
          forma = sin(time+uv.y+uv.x)*0.5+0.5; //Degrade constante en X+Y
          
    fragColor = vec4(vec3(forma),1.0); 

}


#version 150 //Debemos dejar seteada la version en 150.

//2.3
//Frecuencia y tiempo.
//Taller de Livecoding con visuales en GLSL 


uniform float time;
uniform vec2 resolution;

out vec4 fragColor; 


//COMO EL NUMERO PI NO VIENE INCLUDO EN GLSL LO DEFINIMOS MANUALMENTE.
//Utilizamos la estructura #define para definir constantes en el programa.
#define PI 3.14159265359

void main(void)
{   

    vec2 uv = gl_FragCoord.xy / resolution; //Obtengo las coordenadas UV(coordenadas cartesianas.
   
    //Si a la función senoidal le sumamos una variable. veremos que oscilara en relación en esa variable. 
    //En este caso si le colocamos uv.x va a ir haciendo un constante degrade : 
    
    
    //Si a la frecuencia la multiplicamos por PI obtendremos exactamente ese numero de "lineas".
    float freq = 10.*PI; 
    
    float forma = sin(time+uv.x*freq)*0.5+0.5; //Degrade constante en X
    //float forma = sin(time+uv.y*freq)*0.5+0.5; //Degrade constante en Y
    //float forma = sin(time+uv.y*freq+uv.x*freq)*0.5+0.5; //Degrade constante en X+Y
    //float forma = sin(time+uv.y*freq+uv.x*freq); //Así se ve cuando una oscilación es entre -1 y 1
          
          
    fragColor = vec4(vec3(forma),1.0); 

}



#version 150 //Debemos dejar seteada la version en 150.

//2.4
//Mezclando ondas 
//Taller de Livecoding con visuales en GLSL 


uniform float time;
uniform vec2 resolution;

out vec4 fragColor; 


//COMO EL NUMERO PI NO VIENE INCLUDO EN GLSL LO DEFINIMOS MANUALMENTE.
//Utilizamos la estructura #define para definir constantes en el programa.
#define PI 3.14159265359

void main(void)
{   

    vec2 uv = gl_FragCoord.xy / resolution; //Obtengo las coordenadas UV(coordenadas cartesianas.

    float forma  =  sin(time+uv.x*10.*PI)*0.5+0.5; //Degrade constante en X
    float forma2 =  sin(time+uv.y*5.*PI)*0.5+0.5;
    
    //Existen varias maneras de mezclar las ondas senoidales. 
    
    //EJEMPLO 1 : 
    //suma de 2 ondas : 
    float formafinal  = forma + forma2 ; 
    
    
    //EJEMPLO 2 : 
    //Multiplicacion de 2 ondas: 
    //float formafinal  = forma * forma2 ; 
    
    //EJEMPLO 3 : 
    //Mezclarlas dentro de una tercera onda senoidal.
    //float formafinal  = sin(forma * forma2*10+time) ; 
    
    
    fragColor = vec4(vec3(formafinal),1.0); 

}


#version 150 //Debemos dejar seteada la version en 150.

//2.5
//Ondas anidadas
//Taller de Livecoding con visuales en GLSL 


uniform float time;
uniform vec2 resolution;

out vec4 fragColor; 


//COMO EL NUMERO PI NO VIENE INCLUDO EN GLSL LO DEFINIMOS MANUALMENTE.
//Utilizamos la estructura #define para definir constantes en el programa.
#define PI 3.14159265359

void main(void)
{   

    vec2 uv = gl_FragCoord.xy / resolution; //Obtengo las coordenadas UV(coordenadas cartesianas.

    //Probar cambiar el numero 10 en las distintas senoidales para ver como influye la frecuencia de las ondas.
    float formafinal = sin(uv.x*10*PI+time
                            +sin(uv.y*2*PI+time
                            +sin(uv.x*20*PI-time 
                            +sin(uv.y*5*PI-time
                            +sin(uv.x*2*PI-time
                            +sin(uv.y*1*PI-time)
                            +sin(uv.x*10*PI-time))))))*0.5+0.5;
    
    fragColor = vec4(vec3(formafinal),1.0); 

}


#version 150 //Debemos dejar seteada la version en 150.

//3.1
//Colores
//Función MIX : 
 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;

//Declaramos el render de salida
out vec4 fragColor; 


void main(void){


    vec2 uv = gl_FragCoord.xy / resolution; // De esta manera obtenemos las coordenadas cartesianas

    vec3 color1 = vec3(1.0,0.0,0.0); // ROJO
    vec3 color2 = vec3(0.0,0.0,1.0); //AZUL
    
    //Puedo utilizar la función mix para mezclar colores. 
    vec3 colfinal = mix(color1,color2,0.0); //Si el tercer parametro de la función mix es 0 obtengo solo color1
         colfinal = mix(color1,color2,1.0); //Si el tercer parametro de la función mix es 1 obtengo solo color2
         colfinal = mix(color1,color2,0.5); //Obtengo el color intermedio entre uno y otro.
         colfinal = mix(color1,color2,sin(time)*0.5+0.5); //OSCILA ENTRE EL COLOR 1 Y EL COLOR 2.
         
    fragColor = vec4(colfinal,1.0); 
    
}


#version 150 

//3.2
//Colores
//Funciónes HSB y RGB: 
 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;



//FUNCIONES SACADAS DE https://thebookofshaders.com/06/: 
//esta es para transformar si pensamos un color en hsb a rgb, nunca lo use.
vec3 rgb2hsb( in vec3 c ){
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz),
                 vec4(c.gb, K.xy),
                 step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r),
                 vec4(c.r, p.yzx),
                 step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)),
                d / (q.x + e),
                q.x);
}

//  Function from Iñigo Quiles
//  https://www.shadertoy.com/view/MsS3Wc
vec3 hsb2rgb( in vec3 c ){
    vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),
                             6.0)-3.0)-1.0,
                     0.0,
                     1.0 );
    rgb = rgb*rgb*(3.0-2.0*rgb);
    return c.z * mix(vec3(1.0), rgb, c.y);
}


//Declaramos el render de salida
out vec4 fragColor; 

void main(void){


    vec2 uv = gl_FragCoord.xy / resolution; // De esta manera obtenemos las coordenadas cartesianas
    
    
     //Puedo utilizar la función hsb2rgb para expresar los colores en hsb.
     //HSB SIGNIFICA : HUE-SATURATION-BRIGHTNESS (tono,saturacion y brillo).
     //De esta manera el segundo parametro corresponde a la saturación.
     //Y el tercer parametro al brillo
     
    vec3 color = hsb2rgb(vec3(uv.x,1.0-uv.y,uv.y));

    fragColor = vec4(color,1.0); 
    
    
    
    
    
    
    
}

#version 150 

//3.3
//Funcion mix y hsb2rgb para pintar una animación, NO EXISTE UNA DIFERENCIA TANGIBLE ENTRE COLOR Y FORMA
//Funciónes HSB y RGB: 
 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;



//FUNCIONES SACADAS DE https://thebookofshaders.com/06/: 
//esta es para transformar si pensamos un color en hsb a rgb, nunca lo use.
vec3 rgb2hsb( in vec3 c ){
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz),
                 vec4(c.gb, K.xy),
                 step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r),
                 vec4(c.r, p.yzx),
                 step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)),
                d / (q.x + e),
                q.x);
}

//  Function from Iñigo Quiles
//  https://www.shadertoy.com/view/MsS3Wc
vec3 hsb2rgb( in vec3 c ){
    vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),
                             6.0)-3.0)-1.0,
                     0.0,
                     1.0 );
    rgb = rgb*rgb*(3.0-2.0*rgb);
    return c.z * mix(vec3(1.0), rgb, c.y);
}


//Declaramos el render de salida
out vec4 fragColor; 

#define PI 3.14159265359
void main(void){


    vec2 uv = gl_FragCoord.xy / resolution; // De esta manera obtenemos las coordenadas cartesianas
      
     //ES IMPORTANTE COMPRENDER QUE NO EXISTE UNA REAL DIFERENCIA ENTRE FORMA Y COLOR EN GLSL
     //LA DIFERENCIA ENTRE UNA Y OTRA ES ARBITRARIA SEGUN LO QUE EL PROGRAMADORE ENTIENDA COMO TAL.
      
     //Esta es la forma que habíamos hecho en el tutorial anterior.
     //Veremos las opciones existentes que hay para poder pintar un dibujo:
     float formafinal = sin(uv.x*10*PI+time
                            +sin(uv.y*2*PI+time
                            +sin(uv.x*10*PI-time 
                            +sin(uv.y*10*PI-time
                            +sin(uv.x*10*PI-time
                            +sin(uv.y*10*PI-time)
                            +sin(uv.x*10*PI-time))))))*0.5+0.5;
    
    
    //OPCION 1 : 
    //Una opcion es pasar la variable que genera la forma 
    //a algunos de los valores cuando se usa la función hsb2rgb.
    
    //Le multiplicamos los valores para que sea mas atractivo:
    vec3 color_hsb = hsb2rgb(vec3(formafinal,
                               0.5+formafinal*0.5,
                               formafinal*0.7+0.8));
    
    //OPCION 2 :
    //UTILIZAMOS LA FUNCIÓN MIX PARA MEZCLAR 2 COLORES y pasamos como tercer parametro nuestra forma.
    //De esa manera nos va a pintar la forma que le hayamos pasado.
    vec3 color1 = vec3(1.0,0.0,0.0);
    vec3 color2 = vec3(1.0,1.0,0.0);
    
    vec3 colfinal = mix(color1,color2,formafinal);
        
        
    //OPCION 3 :
    //Combinación : 
    
    //Aca lo que hacemos es como inventar colores y luegos utilizarlos para pintar la forma
    //Como se puede observar los componentes de color3 y color4 son complejos
    //Es decir no se limitan a valores entre 0 y 1 . 
    //Puedo "inventar" un color que no sea igual en todos los pixeles para darle mas complejidad a mi visual.
    vec3 color3 = vec3(uv.y,0.,1.-uv.y);
    vec3 color4 = vec3(sin(formafinal*2),sin(uv.y*2.*PI+time)*0.5+0.5,uv.y);
    
    vec3 colfinal2 = mix(color3,color4,formafinal);
        
        
        
    //fragColor = vec4(color_hsb,1.0); 
    //fragColor = vec4(colfinal,1.0); 
    fragColor = vec4(colfinal2,1.0); 
    
}

#version 150 

//3.4
//Multiplicación y suma de colores :
 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;



//FUNCIONES SACADAS DE https://thebookofshaders.com/06/: 
//esta es para transformar si pensamos un color en hsb a rgb, nunca lo use.
vec3 rgb2hsb( in vec3 c ){
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz),
                 vec4(c.gb, K.xy),
                 step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r),
                 vec4(c.r, p.yzx),
                 step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)),
                d / (q.x + e),
                q.x);
}

//  Function from Iñigo Quiles
//  https://www.shadertoy.com/view/MsS3Wc
vec3 hsb2rgb( in vec3 c ){
    vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),
                             6.0)-3.0)-1.0,
                     0.0,
                     1.0 );
    rgb = rgb*rgb*(3.0-2.0*rgb);
    return c.z * mix(vec3(1.0), rgb, c.y);
}


//Declaramos el render de salida
out vec4 fragColor; 

#define PI 3.14159265359
void main(void){


    vec2 uv = gl_FragCoord.xy / resolution; // De esta manera obtenemos las coordenadas cartesianas
      
     //ES IMPORTANTE COMPRENDER QUE NO EXISTE UNA REAL DIFERENCIA ENTRE FORMA Y COLOR EN GLSL
     //LA DIFERENCIA ENTRE UNA Y OTRA ES ARBITRARIA SEGUN LO QUE EL PROGRAMADORE ENTIENDA COMO TAL.
      
     //Esta es la forma que habíamos hecho en el tutorial anterior.
     //Veremos las opciones existentes que hay para poder pintar un dibujo:
     float formafinal = sin(uv.x*10*PI+time
                            +sin(uv.y*2*PI+time
                            +sin(uv.x*10*PI-time 
                            +sin(uv.y*10*PI-time
                            +sin(uv.x*10*PI-time
                            +sin(uv.y*10*PI-time)
                            +sin(uv.x*10*PI-time))))))*0.5+0.5;
    
    float formafinal2 = sin(uv.y*10*PI+time
                            +sin(uv.y*10*PI+time
                            +sin(uv.x*8*PI-time 
                            +sin(uv.y*5*PI-time
                            +sin(uv.x*10*PI-time
                            +sin(uv.y*2*PI-time)
                            +sin(uv.x*9*PI-time))))))*0.5+0.5;
                            
                            
    
   
    vec3 color1 = vec3(1.0,0.0,0.2) ; 
    vec3 color2 = vec3(0.2,0.5,1.0) ; 
    
    
    //Creo una variable en donde voy a hacer todas las cuentas finales. 
    //En donde una forma si la multiplico por ese color va a ser de ese color.
    //Sumo 2 formas que fueron multiplicadas por los colores respectivos.
    
    
    vec3 fin = color1 * formafinal + color2 * formafinal2;
    fragColor = vec4(fin,1.0); 
    
    
    
    
    
    
}

#version 150 

//3.4
//Cambio de fase 
 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;

//Declaramos el render de salida
out vec4 fragColor; 

#define PI 3.14159265359

//Función en la que coloco mi variable de "forma" generada con senoidales.
//Y luego le paso una fase distinta a cada uno : 
float desfase(vec2 uv,float _fase){
      float formafinal = sin(uv.x*10*PI+time
                            +sin(uv.y*2*PI+time
                            +sin(uv.x*10*PI-time 
                            +sin(uv.y*10*PI-time
                            +sin(uv.x*10*PI-time
                            +sin(uv.y*10*PI-time)
                            +sin(uv.x*10*PI-time)))))+_fase)*0.5+0.5;
    //formafinal+=sin(formafinal*20)*0.05;
    return formafinal;
}

void main(void){


    vec2 uv = gl_FragCoord.xy / resolution; // De esta manera obtenemos las coordenadas cartesianas
    
    //Otra manera para elegir buenas paletas de colores puede ser desfasando senoidales.
    //En este caso, los 3 canales tienen la misma forma, pero las senoidales que las generan tienen la fase cambiada
    //Por eso es que se generan distintos colores.
    float r  = desfase(uv,0.0);
    float g  = desfase(uv,PI/5);
    float b  = desfase(uv,PI/2);
    
    
    fragColor = vec4(r,g,b,1.0); 
    
}



#version 150 //Debemos dejar seteada la version en 150.

//4.1
//Formas
//Obtencion de radio y angulo.

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;


//Declaramos el render de salida
out vec4 fragColor; 
void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution; // De esta manera obtenemos las coordenadas cartesianas
    
    //Al igual que cuando utilizamos uv.x y uv.y también podemos utilizar las variables r y a.
    //Estas variables son el radio y el angulo . 
    //Se obtienen de la siguiente manera : 
    
    vec2 p = vec2(0.5) - uv; //Genero un punto en el espacio(en este caso en el medio.
    
    //Obtengo el radio(calcula la distancia del punto del medio con las puntas mas alejadas y por eso me genera el radio 
    float r = length(p);
    
    //obtengo el angulo. (Calcula el angulo existente que hay en el punto p.)
    float a = atan(p.x,p.y);
    
    fragColor = vec4(r,a,r+a,1.0); //Visualizo solo el radio.
    //fragColor = vec4(vec3(a),1.0); //Visualizo solo el angulo.
    
}


#version 150 //Debemos dejar seteada la version en 150.

//4.2
//Formas
//Uso de radio y angulo como osciladores

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;


//Declaramos el render de salida
out vec4 fragColor; 
void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution; // De esta manera obtenemos las coordenadas cartesianas
    
    
    vec2 p = vec2(0.5) - uv; //Genero un punto en el espacio(en este caso en el medio.
    float r = length(p);  //Obtengo el radio
    float a = atan(p.x,p.y);//obtengo el angulo. 
    
    //También puedo utilizarlas de la misma manera que hice con las uv.x y uv.y para generar formas mas complejas.
    
    vec3 forma_radioangulocompleja = vec3(
                                     sin(r*20-time
                                     +sin(a*10+time
                                     +sin(r*100-time
                                     +sin(a*10
                                     +sin(r*100
                                     +sin(a*10))))))*0.5+0.5);
    fragColor = vec4(forma_radioangulocompleja,1.0); 

}


#version 150 //Debemos dejar seteada la version en 150.

//4.3
//Formas
//Circulo inicial, Funcion step.

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;


//Declaramos el render de salida
out vec4 fragColor; 
void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution; // De esta manera obtenemos las coordenadas cartesianas
    
    //ESTO ES PARA ARREGLAR EL ASPECT RADIO. 
    //Es decir para que no importa la resolución que tenga, el circulo siempre sea un circulo perfecto.
    float fix = resolution.x/resolution.y; //Creo la variable que me permite arreglar esto.
    uv.x*=fix;
    
    
    //EN EL P también lo tengo que multiplicar por el fix.
    vec2 p = vec2(0.5*fix,0.5) - uv; //Genero un punto en el espacio(en este caso en el medio.
    float r = length(p);  //Obtengo el radio
    float a = atan(p.x,p.y);//obtengo el angulo. 
    
    
    
    //LA FUNCIÓN STEP FUNCIONA COMO SI FUERA UN UMBRAL. 
    //TODOS LOS VALORES DEBAJO DE 0.9 LOS TRANSFORMA EN 0. 
    //TODOS LOS VALORES ARRIBA DE 0.9 LOS TRANSFORMA EN 1.
    
    //LO MISMO SI LO HAGO CON uv.x , uv.y , a , o cualquier valor que yo le pase. 
    float e = step(0.9,1.-r); //aca uso 1.-r para que me de el valor invertido, entonces negro pasa a blanco y blanco a negro.
          //e = step(0.9,uv.y);
          //e = step(0.9,uv.x); //Este se ve mitad negro mitad blanco porque cuando utilizamos fix pasan estas cosas.
          //e = step(0.9,a);
    
       
    fragColor = vec4(vec3(e),1.0); 

}




#version 150 //Debemos dejar seteada la version en 150.

//4.4
//Formas
//Circulo avanzado - smoothstep

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;


//Declaramos el render de salida
out vec4 fragColor; 
void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution; // De esta manera obtenemos las coordenadas cartesianas
    
    //ESTO ES PARA ARREGLAR EL ASPECT RADIO. 
    //Es decir para que no importa la resolución que tenga, el circulo siempre sea un circulo perfecto.
    float fix = resolution.x/resolution.y; //Creo la variable que me permite arreglar esto.
    uv.x*=fix;
    
    
    //EN EL P también lo tengo que multiplicar por el fix.
    vec2 p = vec2(0.5*fix,0.5) - uv; //Genero un punto en el espacio(en este caso en el medio.
    float r = length(p);  //Obtengo el radio
    float a = atan(p.x,p.y);//obtengo el angulo. 
    
    
    
    //LA FUNCIÓN SMOOTHSTEP FUNCIONA COMO SI FUERA UN UMBRAL CON LA OPCION DE GRAFICAR VALORES INTERMEDIOS.
    //Esto nos permite hacer un circulo con un borde con degrade.
    
    //TODOS LOS VALORES DEBAJO DE 0.88 LOS TRANSFORMA EN 0. 
    //TODOS LOS VALORES ARRIBA DE 0.9 LOS TRANSFORMA EN 1.
    //TODOS LOS VALORES INTERMEDIOS ENTRE 0.88 y 0.9 LES HACE UNA INTERPOLACION ENTRE 0.0 y 1.0.
    
    //LO MISMO SI LO HAGO CON uv.x , uv.y , a , o cualquier valor que yo le pase. 
    float e = smoothstep(0.88,0.9,1.-r); 
         
    fragColor = vec4(vec3(e),1.0); 

}


#version 150 //Debemos dejar seteada la version en 150.

//4.5
//Formas
//Circulo inicial - Shaping function.

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;


//Declaramos el render de salida
out vec4 fragColor; 
void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution; // De esta manera obtenemos las coordenadas cartesianas
    
    //ESTO ES PARA ARREGLAR EL ASPECT RADIO. 
    //Es decir para que no importa la resolución que tenga, el circulo siempre sea un circulo perfecto.
    float fix = resolution.x/resolution.y; //Creo la variable que me permite arreglar esto.
    uv.x*=fix;
    
    
    //EN EL P también lo tengo que multiplicar por el fix.
    vec2 p = vec2(0.5*fix,0.5) - uv; //Genero un punto en el espacio(en este caso en el medio.
    float r = length(p);  //Obtengo el radio
    float a = atan(p.x,p.y);//obtengo el angulo. 
    
    
    //Puedo utilizar una variable para modificar a mi circulo ahora.
    
    
    
    float mof = sin(a*5.+time)*0.02 ;
          //mof = sin(a*10.+time+sin(r*100+time*10))*0.02;
          //mof = sin(a*50.+time)*0.08*sin(r*100+time);
          //mof = sin(a*10.+time)*0.08*sin(r*100+time);
          //mof = sin(uv.x*200.+time)*0.08*sin(uv.y*200+time);
          //mof = sin(uv.x*100.+time)*0.08*sin(uv.y*50000000+time);
    float e = smoothstep(0.88,0.9,(1.-r)+mof); 

          
    fragColor = vec4(vec3(e),1.0); 

}

#version 150 //Debemos dejar seteada la version en 150.

//4.6
//Formas
//Poligonos

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;

#define PI 3.14159265359
#define TWO_PI PI * 2

//DECLARO UNA FUNCION. ESTA FUNCION ME SIRVE PARA GENERAR POLIGONOS.
//Funcion sacada de : https://thebookofshaders.com/07/
//aunque la transformación a función fue hecha por jp.
float poly(vec2 uv,vec2 p, float s, float dif,int N,float a){
    // Remap the space to -1. to 1.
    vec2 st = p - uv ;
    // Angle and radius from the current pixel
    float a2 = atan(st.x,st.y)+a;
    float r = TWO_PI/float(N);
    float d = cos(floor(.5+a2/r)*r-a2)*length(st);
    float e = 1.0 - smoothstep(s,s+dif,d);
    return e;
}

//Declaramos el render de salida
out vec4 fragColor; 
void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution; // De esta manera obtenemos las coordenadas cartesianas
    
    //ESTO ES PARA ARREGLAR EL ASPECT RADIO. 
    //Es decir para que no importa la resolución que tenga, el circulo siempre sea un circulo perfecto.
    float fix = resolution.x/resolution.y; //Creo la variable que me permite arreglar esto.
    uv.x*=fix;
    
    //TAMBIEN PUEDO UTILIZAR UNA FUNCION PARA HACER POLIGONOS : 
    //los parametros que recibe la funcion son : 
    //-UV, 
    //-posicion(si le pongo el fix tengo que multiplicar el x por el fix),
    //-El tamaño del poligono
    //-El diffuse(osea la interpolacion entre el negro y el blanco.
    //-Cantidad de puntas.
    //-Angulo.
    float e = poly(uv,vec2(0.25*fix,0.25), 0.1,0.05,3,time*0.5); 
          e+= poly(uv,vec2(0.75*fix,0.75), 0.1,0.01,4,-time); 
          e+= poly(uv,vec2(0.25*fix,0.75), 0.1,0.0,5,-time*0.5); 
          e+= poly(uv,vec2(0.75*fix,0.25), 0.0,0.5,5,time); 
          
    fragColor = vec4(vec3(e),1.0); 

}



#version 150 //Debemos dejar seteada la version en 150.

//4.7
//Formas
//Movimiento de formas

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;

#define PI 3.14159265359
#define TWO_PI PI * 2

//DECLARO UNA FUNCION. ESTA FUNCION ME SIRVE PARA GENERAR POLIGONOS.
//Funcion sacada de : https://thebookofshaders.com/07/
//aunque la transformación a función fue hecha por jp.
float poly(vec2 uv,vec2 p, float s, float dif,int N,float a){
    // Remap the space to -1. to 1.
    vec2 st = p - uv ;
    // Angle and radius from the current pixel
    float a2 = atan(st.x,st.y)+a;
    float r = TWO_PI/float(N);
    float d = cos(floor(.5+a2/r)*r-a2)*length(st);
    float e = 1.0 - smoothstep(s,s+dif,d);
    return e;
}

//Declaramos el render de salida
out vec4 fragColor; 
void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution; // De esta manera obtenemos las coordenadas cartesianas
    
    //ESTO ES PARA ARREGLAR EL ASPECT RADIO. 
    //Es decir para que no importa la resolución que tenga, el circulo siempre sea un circulo perfecto.
    float fix = resolution.x/resolution.y; //Creo la variable que me permite arreglar esto.
    uv.x*=fix;
    
    vec2 pos = vec2(0.5);//También podemos animar el movimiento.
    vec2 mov = vec2(sin(time)*0.2,cos(time)*0.2);
    pos+=mov;
     
     
    //EN EL P también lo tengo que multiplicar por el fix.
    vec2 p = vec2(pos.x*fix,pos.y) - uv; //Genero un punto en el espacio(en este caso en el medio.
    float r = length(p);  //Obtengo el radio
    float a = atan(p.x,p.y);//obtengo el angulo. 
    
    
    float mof = sin(a*5.+time)*0.02 ;
    float e = smoothstep(0.88,0.9,(1.-r)+mof);
          
    fragColor = vec4(vec3(e),1.0); 

}

#version 150 //Debemos dejar seteada la version en 150.

//4.8
//Formas
//Formas sin relleno : 

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;


//Declaramos el render de salida
out vec4 fragColor; 
void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution; // De esta manera obtenemos las coordenadas cartesianas
    
    //ESTO ES PARA ARREGLAR EL ASPECT RADIO. 
    //Es decir para que no importa la resolución que tenga, el circulo siempre sea un circulo perfecto.
    float fix = resolution.x/resolution.y; //Creo la variable que me permite arreglar esto.
    uv.x*=fix;
    
    
    //EN EL P también lo tengo que multiplicar por el fix.
    vec2 p = vec2(0.5*fix,0.5) - uv; //Genero un punto en el espacio(en este caso en el medio.
    float r = length(p);  //Obtengo el radio
    float a = atan(p.x,p.y);//obtengo el angulo. 
    
    
    //Puedo utilizar una variable para modificar a mi circulo ahora.
    
    
    
    float mof = sin(a*5.+time)*0.02 ;
          //mof = sin(a*10.+time+sin(r*100+time*10))*0.02;
          //mof = sin(a*50.+time)*0.08*sin(r*100+time);
          //mof = sin(a*10.+time)*0.08*sin(r*100+time);
          //mof = sin(uv.x*200.+time)*0.08*sin(uv.y*200+time);
          //mof = sin(uv.x*100.+time)*0.08*sin(uv.y*50000000+time);
          
          
     //La forma mas facil de hacer una forma sin relleno consiste simplemente en restarle la misma forma pero disminuyendo el tamaño.
     //Esto funciona ya sea que usemos la funcion poly o solo smoothstep.
                
    float e = smoothstep(0.88,0.9,(1.-r)+mof); 
          e-= smoothstep(0.9,0.92,(1.-r)+mof); 
   
    fragColor = vec4(vec3(e),1.0); 

}
#version 150 //Debemos dejar seteada la version en 150.

//4.8
//Formas
//Formas Con borde de distintos colores : 

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;


//Declaramos el render de salida
out vec4 fragColor; 
void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution; // De esta manera obtenemos las coordenadas cartesianas
    
    //ESTO ES PARA ARREGLAR EL ASPECT RADIO. 
    //Es decir para que no importa la resolución que tenga, el circulo siempre sea un circulo perfecto.
    float fix = resolution.x/resolution.y; //Creo la variable que me permite arreglar esto.
    uv.x*=fix;
    
    
    //EN EL P también lo tengo que multiplicar por el fix.
    vec2 p = vec2(0.5*fix,0.5) - uv; //Genero un punto en el espacio(en este caso en el medio.
    float r = length(p);  //Obtengo el radio
    float a = atan(p.x,p.y);//obtengo el angulo. 
    
    
    //Puedo utilizar una variable para modificar a mi circulo ahora.
    
    
    
    float mof = sin(a*5.+time)*0.02 ;
          //mof = sin(a*10.+time+sin(r*100+time*10))*0.02;
          //mof = sin(a*10.+time)*.05*sin(r*100+time);
          //mof = sin(a*10.+time)*0.08*sin(r*100+time);
          //mof = sin(uv.x*200.+time)*0.08*sin(uv.y*200+time);
          //mof = sin(uv.x*100.+time)*0.08*sin(uv.y*50000000+time);
        
    
    
    //Cambiar estos parametros y ver como afectan :
    float size = 0.88; //Tamaño de la figura.
    float diffusesize = size+0.01; //Tamaño del diffuse de la forma
    float bordersize = 0.01; //TAMAÑO DEL BORDE
    float borderdiffuse = 0.005; //Tamaño del diffuse del borde.
    
    float e  = smoothstep(size,diffusesize,(1.-r)+mof);  //Forma 1 
    float e2 = smoothstep(diffusesize+bordersize,diffusesize+bordersize+borderdiffuse,(1.-r)+mof);  // Forma 2 //Aca decido los tamaños.
   
   
    //Declaro 2 colores :
    vec3 col1 = vec3(1.0,0.5,0.3);
    vec3 col2 = vec3(0.3,0.5,1.0);
    
    
    //Como sabemos e2 es la forma mas pequeña y e la forma mas grande. 
    //Si nosotros utilizamos la función mix mezclara segun la forma de la estrella los 2 colores.
    //Luego si col1 es multiplicado por e (la forma mas grande) y e en todos los lugares donde no es la estrella es 0 , entonces 
    //como cualquier numero que multiplico por 0 da 0 , el color es cortado como una mascara. Por eso nos queda solo el borde.
    vec3 fin = mix(col1*e,col2,e2);
   
    fragColor = vec4(fin,1.0); 

}



#version 150 //Debemos dejar seteada la version en 150.

//5.1
//translate rotate scale
//Movimiento de formas (Translate basico).

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;

#define PI 3.14159265359

//Declaramos el render de salida
out vec4 fragColor; 
void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution; // De esta manera obtenemos las coordenadas cartesianas
    //Como en realidad nosotros siempre estamos trabajando con la totalidad de las coordenadas y utilizando
    //todas las uv y no usando una forma. Con simplemente agregarle variables a las uv podemos desplazarlas para generar movimiento.
  
    float fix = resolution.x/resolution.y; 
    uv.x*=fix;
    
    
    vec2 mov = vec2(sin(time)*0.2,cos(time)*0.2); //Movimiento circular simple.
         //mov = vec2(sin(time*2)*0.2,cos(time)*0.2); //Como multiplico x2 entonces se mueve 2 veces antes de dar la vuelta
         //mov = vec2(sin(time*2)*0.5,cos(time*8)*0.4);
  
     
     uv+=mov;//Le agrego el movimiento a las uv 
     
    //EN EL P también lo tengo que multiplicar por el fix.
    vec2 p = vec2(0.5*fix,0.5) - uv; //Genero un punto en el espacio(en este caso en el medio.
    float r = length(p);  //Obtengo el radio
    float a = atan(p.x,p.y);//obtengo el angulo.
    float mof = sin(a*5.+time)*0.05 ;
    float e = smoothstep(0.88,0.9,(1.-r)+mof);
          
    fragColor = vec4(vec3(e),1.0); 

}


#version 150 //Debemos dejar seteada la version en 150.

//5.1
//translate rotate scale
//rotate y scale

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;

#define PI 3.14159265359


mat2 scale(vec2 _scale){
    return mat2(_scale.x,0.0,
                0.0,_scale.y);
}
mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}


//Declaramos el render de salida
out vec4 fragColor; 
void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution; // De esta manera obtenemos las coordenadas cartesianas

    float fix = resolution.x/resolution.y; 
    uv.x*=fix;
    
    
    //scale es una función que devuelve un mat2,
    //mat2 es un tipo de variable que nos permite hacer operaciones matriciales complejas
    //No importa mucho eso. Lo importante es aprender la sintaxis de como funciona.
    
    float oscilator = sin(time)*0.3+0.8;
    //Los pasos para que funcione el scale o rotate son : 
    //trasladar las coordenadas -0.5
    //Utilizar la función scale como esta resuelta aqui: 
    //Volver a trasladar las coordenadas 0.5
    //-Nota : fijarse que si usamos el fix, tenemos que multiplicar.
    
    //APLICO UN SCALE
    uv-=vec2(0.5*fix,0.5);
    uv = scale(vec2(oscilator))*uv;
    uv+=vec2(0.5*fix,0.5);
    
    //APLICO ROTATE.
    uv-=vec2(0.5*fix,0.5);
    uv = rotate2d(time*0.2)*uv;
    uv+=vec2(0.5*fix,0.5);
    
    //EN EL P también lo tengo que multiplicar por el fix.
    vec2 p = vec2(0.5*fix,0.5) - uv; //Genero un punto en el espacio(en este caso en el medio.
    float r = length(p);  //Obtengo el radio
    float a = atan(p.x,p.y);//obtengo el angulo.
    float mof = sin(a*5.+time)*0.05 ;
    float e = smoothstep(0.88,0.9,(1.-r)+mof);
          
         // e = sin(uv.x*20+sin(uv.y*20+time*2)); //Descomentar para ver como actua con este patron.
     
    vec3 fin = vec3(e);
         fin = vec3(sin(uv.x*20+sin(uv.y*20+time*2)));
         //fin = vec3(uv.x,uv.y,1.0);
    fragColor = vec4(fin,1.0); 
}

#version 150 //Debemos dejar seteada la version en 150.

//5.1
//translate rotate scale
//TRANSLATE ROTATE Y SCALE CON 2 POLIGONOS COMBINADOS.

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;

#define PI 3.14159265359
#define TWO_PI PI*2
mat2 scale(vec2 _scale){
    return mat2(_scale.x,0.0,
                0.0,_scale.y);
}
mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}

//HAGO FUNCIONES PARA ESCALAR UVS EN UNA SOLA LINEA !!
vec2 scale(vec2 uv,vec2 _sc){
    float fix = resolution.x/resolution.y; 
    uv-=vec2(0.5*fix,0.5);
    uv = scale(_sc)*uv;
    uv+=vec2(0.5*fix,0.5);
    return uv;
}
//HAGO FUNCIONES PARA ROTAR UVS EN UNA SOLA LINEA !!
vec2 rotate2d(vec2 uv,float _rot){
    float fix = resolution.x/resolution.y; 
    uv-=vec2(0.5*fix,0.5);
    uv = rotate2d(_rot)*uv;
    uv+=vec2(0.5*fix,0.5);
    return uv;
}

float poly(vec2 uv,vec2 p, float s, float dif,int N,float a){
    // Remap the space to -1. to 1.
    vec2 st = p - uv ;
    // Angle and radius from the current pixel
    float a2 = atan(st.x,st.y)+a;
    float r = TWO_PI/float(N);
    float d = cos(floor(.5+a2/r)*r-a2)*length(st);
    float e = 1.0 - smoothstep(s,s+dif,d);
    return e;
}

//Declaramos el render de salida
out vec4 fragColor; 
void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution; // De esta manera obtenemos las coordenadas cartesianas
    
    
    
    float fix = resolution.x/resolution.y; 
    uv.x*=fix;
    
    
    //podemos hacer copias de las uv original y luego utilizar translate, rotate y scale en las distintas uv.
    //De esta manera tener podemos tener coordenadas con distintas escalas, rotaciones y translates.
    
    vec2 uv2 = uv;
    vec2 uv3 = uv;
    
    uv2.x-=0.5;
    uv2.x+=sin(time*3)*0.2; //TRANSLATE
    uv2 = scale(uv2,vec2(2.8));  //SCALE
    uv2 = rotate2d(uv2,time); //ROTATE
    
    uv3.x+=0.5;
    uv3.y+=sin(time*5)*0.2; //TRANSLATE
    uv3 = scale(uv3,vec2(0.9));  //SCALE
    uv3 = rotate2d(uv3,-time); //ROTATE
    
    //COMO PODEMOS OBSERVAR , AMBOS POLIGONOS TIENEN LOS MISMOS VALORES EXCEPTO POR LAS UVS QUE RECIBEN. 
    //DE ESTA MANERA QUEDA DEMOSTRADO EL PODER QUE TIENEN LAS OPERACIONES MATRICIALES EN DONDE UN DIBUJO PUEDE CAMBIAR     
    //COMPLETAMENTE SOLO CON OPERACIONES MATRICIALES
    vec3 dibujo1 = vec3(poly(uv2,vec2(0.5*fix,0.5),0.1,0.1,3,0.0));           
    vec3 dibujo2 = vec3(poly(uv3,vec2(0.5*fix,0.5),0.1,0.1,3,0.0));
                    
                    
    vec3 fin = dibujo1+dibujo2;      
    fragColor = vec4(fin,1.0); 
}

#version 150 //Debemos dejar seteada la version en 150.

//5.1
//translate rotate scale
//Movimiento de formas (Translate basico).

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;

#define PI 3.14159265359


mat2 scale(vec2 _scale){
    return mat2(_scale.x,0.0,
                0.0,_scale.y);
}
mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}




//Declaramos el render de salida
out vec4 fragColor; 
void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution; // De esta manera obtenemos las coordenadas cartesianas

    float fix = resolution.x/resolution.y; 
    uv.x*=fix;
    
    
    //scale es una función que devuelve un mat2,
    //mat2 es un tipo de variable que nos permite hacer operaciones matriciales complejas
    //No importa mucho eso. Lo importante es aprender la sintaxis de como funciona.
    
    float oscilator = sin(time)*0.3+0.8;
    //Los pasos para que funcione el scale o rotate son : 
    //trasladar las coordenadas -0.5
    //Utilizar la función scale como esta resuelta aqui: 
    //Volver a trasladar las coordenadas 0.5
    //-Nota : fijarse que si usamos el fix, tenemos que multiplicar.
    
    uv-=vec2(0.5*fix,0.5);
    uv = rotate2d(time*0.2)*uv;
    uv+=vec2(0.5*fix,0.5);
          
    //EN EL P también lo tengo que multiplicar por el fix.
    vec2 p = vec2(0.5*fix,0.5) - uv; //Genero un punto en el espacio(en este caso en el medio.
    float r = length(p);  //Obtengo el radio
    float a = atan(p.x,p.y);//obtengo el angulo.
    float mof = sin(a*5.)*0.05 ;
    float e = smoothstep(0.88,0.9,(1.-r)+mof);
          //e = sin(uv.x*20+sin(uv.y*20)); //Descomentar para ver como actua con este patron.
  
    fragColor = vec4(vec3(e),1.0); 
}


#version 150 //Debemos dejar seteada la version en 150.

//6.2
//Fracts
//Intro de la funcion fract

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;



//Declaramos el render de salida
out vec4 fragColor; 
void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution;


    //Obtiene la parte decimal de una variable
    //La funcion fract lo que hace es siempre transformar los valores mayores a 1 a 0.1. 
    
    //Veamos el siguiente caso : 
    //habiamos establecido que uv.x es una variable que va de 0 a 1, de izquierda a derecha. 
    //Si yo ese valor lo multiplico por 10 entonces ira de 0 a 10. 
    
    //La funcion fract lo que hace es : 
    //-Si el valor es 1.1 transformarlo en 0.1, 
    //-Si el valor es 2.4 lo transforma en 0.4.
    
    //Entonces como podemos ver en el dibujo, lo que esta sucediendo es que cuando el valor llega a 1.1, lo transforma a 0.1.

    vec3 fin = vec3(fract(uv.x*10));
      
    fragColor = vec4(fin,1.0); 
}

#version 150 //Debemos dejar seteada la version en 150.

//6.2
//Fracts
//Subdivisión del espacio.

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;


#define PI 3.14159265359
#define TWO_PI PI*2
//Declaramos el render de salida
out vec4 fragColor; 

float poly(vec2 uv,vec2 p, float s, float dif,int N,float a){
    // Remap the space to -1. to 1.
    vec2 st = p - uv ;
    // Angle and radius from the current pixel
    float a2 = atan(st.x,st.y)+a;
    float r = TWO_PI/float(N);
    float d = cos(floor(.5+a2/r)*r-a2)*length(st);
    float e = 1.0 - smoothstep(s,s+dif,d);
    return e;
}

void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution;


    //La subdivision del espacio con la función fract es clave si queremos hacer elementos repetidos:
    
    uv = fract(uv*10); //ACA LE DIGO CUANTO TIENE QUE SUBDIVIDIR EL ESPACIO.
    
    vec2 p = vec2(0.5) -uv;
    float r = length(p);
    float a  = atan(p.x,p.y);
    
    
    //DESCOMENTAR PARA VER LOS DISTINTOS EJEMPLOS
    vec3 fin = vec3(uv,1.0);
         //fin = vec3(poly(uv,vec2(0.5,0.5),0.25,0.1,5,time)); 
         //fin = vec3(sin(r*20+time));
        
    fragColor = vec4(fin,1.0); 
}

#version 150 //Debemos dejar seteada la version en 150.

//6.3
//Fracts
//UVS combinadas.

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;


#define PI 3.14159265359
#define TWO_PI PI*2
//Declaramos el render de salida
out vec4 fragColor; 

float poly(vec2 uv,vec2 p, float s, float dif,int N,float a){
    // Remap the space to -1. to 1.
    vec2 st = p - uv ;
    // Angle and radius from the current pixel
    float a2 = atan(st.x,st.y)+a;
    float r = TWO_PI/float(N);
    float d = cos(floor(.5+a2/r)*r-a2)*length(st);
    float e = 1.0 - smoothstep(s,s+dif,d);
    return e;
}

void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution;
    vec2 uv_circulos = fract(uv*20);
    
    //AL IGUAL QUE COMO HABIAMOS HECHO EN EL EJEMPLO DEL TRANSLATE ,SCALE Y ROTATE.
    //PODEMOS DECLARAR MAS DE UNAS COORDENADAS UV Y USARLAS EN PARALELO Y LUEGO COMBINARLAS.
    //EN ESTE CASO ESTAMOS UTILIZANDO UN PATRON DE CIRCULOS 
    //EN EL CUAL EL TAMAÑO ES DECIDIDO POR OTRO PATRON QUE USA OTRAS UV
    

    vec2 p = vec2(0.5) -uv;
    float r = length(p);
    float a  = atan(p.x,p.y);
    
    //Esta es la forma con la que se decidiran los tamaños de los circulos:
    //Ejemplo forma2 1 :
    float forma2 = sin(r*10+time)*0.5+0.5;
    
     //Ejemplo forma2 2 :
     //forma2 = sin(uv.x*10+time)*0.5+0.5;
      
     //Ejemplo forma2 3 :
     //forma2 = poly(uv,vec2(0.5,0.5),0.0,0.2,3,time);
          
          
    //DESCOMENTAR PARA VER LOS DISTINTOS EJEMPLOS
    
    //En este ejemplo usamos "forma2 para variar los parametros de la función poly, 
    //y así poder hacer que la grilla de poligonos reaccione de manera distinta. 
    
    //EJEMPLO POLY 1 CAMBIAMOS EL TAMAÑO: 
     vec3  fin = vec3(poly(uv_circulos,vec2(0.5,0.5),0.0,forma2,30,time)); 
    
    //EJEMPLO POLY 2 CAMBIAMOS EL ANGULO: 
    //fin = vec3(poly(uv_circulos,vec2(0.5,0.5),0.2,0.1,3,forma2)); 
        
     //EJEMPLO POLY 2 CAMBIAMOS LA POSICION: 
     //fin = vec3(poly(uv_circulos,vec2(forma2*0.2+0.5,0.5),0.1,0.2,3,0.)); 
           
    //EJEMPLO POLY 3 MUESTRA DE COMO CORTA LA PANTALLA :
    //ACLARACION : hay que tener cuidado cuando manejamos una grilla,
    //porque si el elemento que manejamos 
    //toca los bordes de la uv subdivida percibimos el corte.
    //Ese corte si no es intencional puede percibirse como un error,
    //una manera de evitarlo es no 
    //moviendo mucho la posición o si movemos la posición achicar el poligono. 
    //Siempre debemos asegurarnos que la forma no toque la pantalla si queremos evitarlo :
    // fin = vec3(poly(uv_circulos,vec2(forma2*0.2+0.5,0.5),0.2,0.3,3,forma2));
            
            
            
    vec3 color = vec3(1.-r,0.5,sin(r*10)*0.5+0.5);//Creamos un color
    fin*=color; //Lo multiplicamos para que tome ese color.
    
    
    fragColor = vec4(fin,1.0); 
}

#version 150 //Debemos dejar seteada la version en 150.

//6.4
//Fracts
//UVS combinadas.

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;


#define PI 3.14159265359
#define TWO_PI PI*2
//Declaramos el render de salida
out vec4 fragColor; 

float poly(vec2 uv,vec2 p, float s, float dif,int N,float a){
    // Remap the space to -1. to 1.
    vec2 st = p - uv ;
    // Angle and radius from the current pixel
    float a2 = atan(st.x,st.y)+a;
    float r = TWO_PI/float(N);
    float d = cos(floor(.5+a2/r)*r-a2)*length(st);
    float e = 1.0 - smoothstep(s,s+dif,d);
    return e;
}

void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution;
    float fix = resolution.x/resolution.y;
    
    
    //Otra fantastica ventaja al usar fract es que si desplazamos las uv constantemente en      un eje.
    //El dibujo volvera por el otro lado, para que esto funcione. 
    //El desplazamiento debe hacerse previo a aplicar la funcion fract a las uvs.
    uv.x*=fix;
    uv = fract(uv*5+time*0.25); //Lo desplazo en las dos posiciones.
    //uv = fract(vec2(uv.x*5,uv.y*5+time*0.25));//Lo desplazo solo en y
    
    //También puedo utilizar el fract mas en un eje que en el otro : 
    // uv = fract(vec2(uv.x*2-time*0.25,uv.y*2));//Lo desplazo solo en x
    
       
    float e = poly(uv,vec2(0.5),0.1,0.1,3,time);
     vec3 fin = vec3(e); //POLY CON FIX 
           
    fragColor = vec4(fin,1.0); 
}


#version 150 //Debemos dejar seteada la version en 150.

//7.1
//Fors
//Fors para sumar posiciones.

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;


#define PI 3.14159265359
#define TWO_PI PI*2
//Declaramos el render de salida
out vec4 fragColor; 

void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution;
    float fix = resolution.x/resolution.y;
    uv.x*=fix;
    
    //Los fors son una estructura repetitiva 
    //que nos permiten hacer una misma operación varias veces. 
    //Eso puede tener varias ventajas cuando queremos
    //correr lineas de codigos con ligeras variaciones pero sin necesidad
    //de volver a escribir todo el codigo. 
    
    
    //Los fors tienen 3 elementos : 
    
    //-El valor inicial : int i = 0; 
    //-El limite : i<cantidad; 
    //-El aumento : i++
    
    //El valor inicial nos permite indicar que valor tendra i 
    //la primera vez que recorre el bucle.
    
    //El limite nos indica la condicion por la cual se mantendra dentro del bucle
    //En este caso mientras que i sea menor que cantidad. 
    //El aumento nos indica cuanto aumenta i en cada frame.
    
    int cantidad = 5;//Defino la cantidad de iteraciones que tendra mi for
    float amp = 0.2; //Variable para manejar la amplitud de los circulos.
    vec3 fin = vec3(0.0);//Defino un vec3 en el que ire sumando los circulos.
    
    //Todo lo que este dentro de los corchetes del 
    //for es lo que se va a repetir constatemente
    
    
    for(int i =0; i< cantidad; i++){
            
            
        //Aca lo que hago es basicamente hacer la cuenta para obtener que:
        //Cuando i = 0, index = 0. 
        //cuando i = cantidad-1 , index = PI*2.
        //Esta transformación la uso para pasarla como fase a las sinuidales 
        //del movimiento. Esto nos permite hacer que los 5 circulos esten 
        //en distancias exactas y poder cambiar la cantidad y que siga manteniendose
        float index = i*PI*2.0/cantidad; 
        
        
        vec2 pos = vec2(0.5*fix,0.5);//Defino una posicion 
        
        //genero un vector de movimiento para generar movimiento circular
        //y le agrego el index para que todos se muevan en fase
        vec2 mov = vec2(sin(time+index)*amp,cos(time+index)*amp);
        pos+=mov; // sumo el movimiento a la posicion.
        
        vec2 p = pos - uv; // defino un punto.
        float r = length(p); //obtengo el radio
        
        
        fin+= smoothstep(0.95,0.99,1.-r); //Sumo el dibujo del circulo a mi vector final
        
        //Cada vez que termina de correr el bucle una vez, 
        //lo vuelve a correr y la variable i aumenta en uno (i++)    
    }
    fragColor = vec4(fin,1.0); 
}


#version 150 //Debemos dejar seteada la version en 150.

//7.1
//Fors
//Fors para sumar posiciones.

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;


#define PI 3.14159265359
#define TWO_PI PI*2
//Declaramos el render de salida
out vec4 fragColor; 

void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution;
    float fix = resolution.x/resolution.y;
    uv.x*=fix;

    
    int cantidad = 10;//Defino la cantidad de iteraciones que tendra mi for
    vec3 fin = vec3(0.0);//Defino un vec3 en el que ire sumando los circulos.
    
    vec2 uv2 = uv;
    for(int i =0; i< cantidad; i++){
        
         //Defino unas nuevas uv para que en cada for lo que cambien sean las uvs
         //En este caso como i va cambiando en cada frame. Entonces el fract
         //se va haciendo mayor, lo que genera que se agreguen todas las capas.
        vec2 uv2 = fract(uv2*(i+1)+time*0.5);  
        
                
            
        vec2 pos = vec2(0.5*fix,0.5);//Defino una posicion 
        vec2 p = pos - uv2; // defino un punto.
        float r = length(p); //obtengo el radio
        
        fin+= smoothstep(0.9,0.99,1.-r); //Sumo el dibujo del circulo a mi vector final
    }
    fragColor = vec4(fin,1.0); 
}

#version 150 //Debemos dejar seteada la version en 150.

//7.1
//Fors
//Fors para sumar posiciones.

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;


#define PI 3.14159265359
#define TWO_PI PI*2
//Declaramos el render de salida
out vec4 fragColor; 

void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution;
    float fix = resolution.x/resolution.y;
    uv.x*=fix;

    
    int cantidad = 30;//Defino la cantidad de iteraciones que tendra mi for
    vec3 fin = vec3(0.0);//Defino un vec3 en el que ire sumando los circulos.
    
    vec2 uv2 = uv;
    for(int i =0; i< cantidad; i++){
        

        vec2 uv2 = fract(uv2*(i+1)+time*0.5);              
        vec2 pos = vec2(0.5*fix,0.5);//Defino una posicion 
        vec2 p = pos - uv2; // defino un punto.
        float r = length(p); //obtengo el radio
        
        
        vec3 col1 = vec3(1.0,1.0,0.0);
        vec3 col2 = vec3(1.0,0.0,0.0);
        
        
        //Con esta tecnica puedo 
        //asignarle distintos colores a las distintas capas que voy agregando
        //(i+1)/float(cantidad) me devuelve de 0.0 a 1.0 la relacion de i,cantidad.
        
        vec3 colf = mix(col1,col2,(i+1)/float(cantidad));
        //Sumo el dibujo del circulo a mi vector final
        fin+= smoothstep(0.9,0.99,1.-r)*colf; 
    }
    fragColor = vec4(fin,1.0); 
}


#version 150 //Debemos dejar seteada la version en 150.

//7.1
//Fors
//Fors para sumar posiciones.

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;


#define PI 3.14159265359
#define TWO_PI PI*2
//Declaramos el render de salida
out vec4 fragColor; 

void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution;
    float fix = resolution.x/resolution.y;
    uv.x*=fix;

    
    int cantidad = 20;//Defino la cantidad de iteraciones que tendra mi for
    vec3 fin = vec3(0.0);//Defino un vec3 en el que ire sumando los circulos.
    
    vec2 uv2 = uv;
    for(int i =0; i< cantidad; i++){
        
        
        float index = i*PI*2.0/cantidad; 
        
        
        //Al agregarle al movimiento circular a la traslacion de cada uvec2
        // Y a su vez a cada uv hacerle un fract distinto puedo percibir particulas
        //en profundidad.
        vec2 mov = vec2(sin(time+index),cos(time+index));
        
       // float multiplyer = sin(time)*0.5+0.8a;
        vec2 uv2 = fract(uv2*(i+1)+mov);              
        vec2 pos = vec2(0.5*fix,0.5);//Defino una posicion 
        vec2 p = pos - uv2; // defino un punto.
        float r = length(p); //obtengo el radio
        
        
        vec3 col1 = vec3(1.0,1.0,0.0);
        vec3 col2 = vec3(1.0,0.0,0.0);
        
        
        //Con esta tecnica puedo 
        //asignarle distintos colores a las distintas capas que voy agregando
        //(i+1)/float(cantidad) me devuelve de 0.0 a 1.0 la relacion de i,cantidad.
        
        vec3 colf = mix(col1,col2,(i+1)/float(cantidad));
        //Sumo el dibujo del circulo a mi vector final
        fin+= smoothstep(0.94,0.99,1.-r)*colf; 
    }
    fragColor = vec4(fin,1.0); 
}


#version 150 //Debemos dejar seteada la version en 150.

//7.1
//Fors
//Fors para sumar posiciones.

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;
#define PI 3.14159265359
#define TWO_PI PI*2
mat2 scale(vec2 _scale){
    return mat2(_scale.x,0.0,
                0.0,_scale.y);
}
mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}

//HAGO FUNCIONES PARA ESCALAR UVS EN UNA SOLA LINEA !!
vec2 scale(vec2 uv,vec2 _sc){
    float fix = resolution.x/resolution.y; 
    uv-=vec2(0.5*fix,0.5);
    uv = scale(_sc)*uv;
    uv+=vec2(0.5*fix,0.5);
    return uv;
}
//HAGO FUNCIONES PARA ROTAR UVS EN UNA SOLA LINEA !!
vec2 rotate2d(vec2 uv,float _rot){
    float fix = resolution.x/resolution.y; 
    uv-=vec2(0.5*fix,0.5);
    uv = rotate2d(_rot)*uv;
    uv+=vec2(0.5*fix,0.5);
    return uv;
}

//DECLARO UNA FUNCION. ESTA FUNCION ME SIRVE PARA GENERAR POLIGONOS.
//Funcion sacada de : https://thebookofshaders.com/07/
//aunque la transformación a función fue hecha por jp.
float poly(vec2 uv,vec2 p, float s, float dif,int N,float a){
    // Remap the space to -1. to 1.
    vec2 st = p - uv ;
    // Angle and radius from the current pixel
    float a2 = atan(st.x,st.y)+a;
    float r = TWO_PI/float(N);
    float d = cos(floor(.5+a2/r)*r-a2)*length(st);
    float e = 1.0 - smoothstep(s,s+dif,d);
    return e;
}


//Declaramos el render de salida
out vec4 fragColor; 

void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution;
    float fix = resolution.x/resolution.y;
    uv.x*=fix;

    vec2 p = vec2(0.5*fix,0.5) - uv;
    float r = length(p);
    float a = atan(p.x,p.y);
    
    int cantidad = 10;//Defino la cantidad de iteraciones que tendra mi for
    vec3 fin = vec3(0.0);//Defino un vec3 en el que ire sumando los circulos.
    
    vec2 uv2 = uv;
    for(int i =0; i< cantidad; i++){
        
        float index = i*PI*2.0/cantidad; 
        
        
        //ACA EL SCALE SE ESTA APLICANDO EN CADA BUCLE, ENTONCES EN CADA BUCLE A UV2 LE HACE UN SCALE 
        //*1.3, lo que equivale a hacerlo mas pequeño.
        uv2-=vec2(0.5*fix,0.5);
        uv2 = scale(vec2(1.2))*uv2; 
        uv2+=vec2(0.5*fix,0.5);

        //Esta tecnica es para que en una 
        //pasada del bucle sume figura y en la otra pasada del bucle reste.
        //Entonces visualmente queda asi :
        if(mod(i,2) == 0){
           // fin+= poly(uv2,vec2(0.5*fix,0.5),0.35,0.05,3,0);
           //Aca hago que cambie el angulo en relación al indice y que gire para un lado
            fin+= poly(uv2,vec2(0.5*fix,0.5),0.35,0.05,3,index+time); 
        }else{
            //fin-= poly(uv2,vec2(0.5*fix,0.5),0.4,0.05,3,0); 
            //Aca hago que cambie el angulo 
            //en relación al indice y que gire para el otro lado.
            fin-= poly(uv2,vec2(0.5*fix,0.5),0.35,0.05,3,index-time); 
        }
    }
    fragColor = vec4(fin,1.0); 
}


#version 150 //Debemos dejar seteada la version en 150.

//7.1
//Fors
//Fors para sumar posiciones.

//Taller de Livecoding con visuales en GLSL 4.0 

 
//Variables uniform para manejar la interfaz
uniform float time;
uniform vec2 resolution;
#define PI 3.14159265359
#define TWO_PI PI*2
mat2 scale(vec2 _scale){
    return mat2(_scale.x,0.0,
                0.0,_scale.y);
}
mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}

//HAGO FUNCIONES PARA ESCALAR UVS EN UNA SOLA LINEA !!
vec2 scale(vec2 uv,vec2 _sc){
    float fix = resolution.x/resolution.y; 
    uv-=vec2(0.5*fix,0.5);
    uv = scale(_sc)*uv;
    uv+=vec2(0.5*fix,0.5);
    return uv;
}
//HAGO FUNCIONES PARA ROTAR UVS EN UNA SOLA LINEA !!
vec2 rotate2d(vec2 uv,float _rot){
    float fix = resolution.x/resolution.y; 
    uv-=vec2(0.5*fix,0.5);
    uv = rotate2d(_rot)*uv;
    uv+=vec2(0.5*fix,0.5);
    return uv;
}

//DECLARO UNA FUNCION. ESTA FUNCION ME SIRVE PARA GENERAR POLIGONOS.
//Funcion sacada de : https://thebookofshaders.com/07/
//aunque la transformación a función fue hecha por jp.
float poly(vec2 uv,vec2 p, float s, float dif,int N,float a){
    // Remap the space to -1. to 1.
    vec2 st = p - uv ;
    // Angle and radius from the current pixel
    float a2 = atan(st.x,st.y)+a;
    float r = TWO_PI/float(N);
    float d = cos(floor(.5+a2/r)*r-a2)*length(st);
    float e = 1.0 - smoothstep(s,s+dif,d);
    return e;
}


//Declaramos el render de salida
out vec4 fragColor; 

void main(void)
{
 
    vec2 uv = gl_FragCoord.xy / resolution;
    float fix = resolution.x/resolution.y;
    //uv.x*=fix;

    vec2 p = vec2(0.5*fix,0.5) - uv;
    float r = length(p);
    float a = atan(p.x,p.y);
    
    int cantidad = 5;//Defino la cantidad de iteraciones que tendra mi for
    vec3 fin = vec3(0.0);//Defino un vec3 en el que ire sumando los circulos.
    
  
    for(int i =0; i< cantidad; i++){
        
        float index = i*PI*2.0/cantidad; 
        
        
        vec2 uv2 = fract(vec2(uv.x,uv.y)*i);
    
 
        vec2 p2 = vec2(0.5,0.5) - uv2;
        float r2 = length(p2);
        float a2 = atan(p2.x,p2.y);
  
        //Defino una forma : 
        float e = sin(r2*10+time+sin(r2*10+time)*0.2);
        
        //Le invento los colores 
        vec3 col1 = vec3(e+0.5,e,e+0.8);
        vec3 col2 = vec3(e+0.2,e+0.20,0.8);
        
        vec3 dib = mix(col1,col2,i/cantidad)*e; //Le pongo la forma con los colores y que los calcule en relacion a la forma
        fin +=dib;
    }
    fin/=cantidad;
    fragColor = vec4(fin,1.0); 
}



#version 150 //Debemos dejar seteada la version en 150.

//8.1
//Feedback
//Sumar feedback.

//Taller de Livecoding con visuales en GLSL 4.0 

 

uniform float time;
uniform vec2 resolution;

//Declaración del uniform de feedback.
uniform sampler2D prevFrame; 

//FUNCIONES SACADAS DE https://thebookofshaders.com/06/: 
//esta es para transformar si pensamos un color en hsb a rgb, nunca lo use.
vec3 rgb2hsb( in vec3 c ){
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz),
                 vec4(c.gb, K.xy),
                 step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r),
                 vec4(c.r, p.yzx),
                 step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)),
                d / (q.x + e),
                q.x);
}

//  Function from Iñigo Quiles
//  https://www.shadertoy.com/view/MsS3Wc
vec3 hsb2rgb( in vec3 c ){
    vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),
                             6.0)-3.0)-1.0,
                     0.0,
                     1.0 );
    rgb = rgb*rgb*(3.0-2.0*rgb);
    return c.z * mix(vec3(1.0), rgb, c.y);
}

out vec4 fragColor;

void main(void){
    vec2 uv = gl_FragCoord.xy / resolution;
    
    //La tecnica de "feedback" consiste en la mezcla entre el frame anterior y el frame actual.
    //Es decir, la imagen que se genero un frame anterior antes de que se genere una nueva.
    
    //Para obtener el feedback es necesario acceder a la uniform sampler2D. 
    //sampler2D es un tipo de variable de GLSL utilizada para manejar texturas.
    
    //Para transformar de sampler2D a un vec4 es necesaria esta operacion : 
    vec4 feedback = texture(prevFrame,uv);
    //La función texture recibe como parametro el sampler2D y las coordenadas uv. 
    

    //Defino la forma: 
    float e = sin(uv.x*100+time*10);
          //e = smoothstep(0.95,0.98,1.-length(vec2(0.5+sin(time)*0.1,0.5+cos(time)*0.1)-uv)); //Circulo en una sola linea.
          e = smoothstep(0.88,0.88,1.-length(vec2(0.5+sin(time*0.5)*0.4,0.5+cos(time*4)*0.4)-uv)); //Circulo sin degrade
          
    //Vamos a crear un dibujo en que constantemente vaya cambiando el tono.
    vec3 dib = vec3(e) * hsb2rgb(vec3(sin(time)*0.5+0.5,0.8,1.0)); 
         

       
    //Feedback sumado :  
    //El problema con sumarla es que corro el riesgo de que se me sature la imagen
    //Entonces tengo la opcion de ponerle menos feedback o si no de multiplicar el dibujo por un menor valor para 
    //equilibrarlo. Es importante comprender que el feedback cuando lo sumo siempre tiene que estar multiplicado por 
    //Valores menores a 1.0 porque si no la imagen se quemara. 
    
    vec3  fin = dib;
    
         //fin = dib + feedback.rgb*0.99; //opcion 1.A (imagen semiquemada).
         //fin = dib*0.04 + feedback.rgb*0.96;
         
         //feedback.rgb = smoothstep(0.01,0.99,feedback.rgb);
         fin = mix(feedback.rgb*0.97,dib,dib);
         
         float limit = 0.07;
         if(fin.r < limit){
         fin.r = 0.0;
         }
         if(fin.g < limit){
         fin.g = 0.0;
         }
         if(fin.b < limit){
         fin.b = 0.0;
         }
         
         
         
         //opcion 1.B(El feedback es el mismo, 
         //el dibujo esta multiplicado * 0.1).
         //fin = dib + feedback.rgb*0.6;
         //opcion 1.C(multiplico el feedback por un menor valor).
        
       // fin = smoothstep(0.1,0.9,fin);
    fragColor = vec4(fin,1.0);
}
#version 150 //Debemos dejar seteada la version en 150.

//8.2
//Feedback
//feedback mix

//Taller de Livecoding con visuales en GLSL 4.0 

 

uniform float time;
uniform vec2 resolution;

//Declaración del uniform de feedback.
uniform sampler2D prevFrame; 

//FUNCIONES SACADAS DE https://thebookofshaders.com/06/: 
//esta es para transformar si pensamos un color en hsb a rgb, nunca lo use.
vec3 rgb2hsb( in vec3 c ){
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz),
                 vec4(c.gb, K.xy),
                 step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r),
                 vec4(c.r, p.yzx),
                 step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)),
                d / (q.x + e),
                q.x);
}

//  Function from Iñigo Quiles
//  https://www.shadertoy.com/view/MsS3Wc
vec3 hsb2rgb( in vec3 c ){
    vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),
                             6.0)-3.0)-1.0,
                     0.0,
                     1.0 );
    rgb = rgb*rgb*(3.0-2.0*rgb);
    return c.z * mix(vec3(1.0), rgb, c.y);
}

out vec4 fragColor;

void main(void){
    vec2 uv = gl_FragCoord.xy / resolution;


    //La función texture recibe como parametro el sampler2D y las coordenadas uv. 
    vec4 feedback = texture(prevFrame,uv);
    
    //Hago un vector para manejar el movimiento : 
    vec2 mov = vec2(sin(time*0.5)*0.4,cos(time*4)*0.4); //Movimiento complejo
         //mov = vec2(sin(time*4)*0.2,cos(time*4)*0.2); //Movimiento circular
         mov = vec2(sin(time*4)*0.4,cos(time*0.5)*0.4);
    
    
    //Defino la forma: 
    float e = sin(uv.x*100+time*10);
          e = smoothstep(0.88,0.90,1.-length(vec2(0.5)+mov-uv)); //Circulo en una sola linea.
          //e = smoothstep(0.88,0.88,1.-length(vec2(0.5)+mov-uv)); //Circulo sin degrade
           
    //Defino el dibujo (color y forma). 
    vec3 dib = vec3(e) * hsb2rgb(vec3(sin(time)*0.5+0.5,0.8,1.0)); 
    
    //Feedback mix
    
    vec3  fin = dib;
          
          //Opcion 1 : 
          //Esta opcion genera como una especie de motion blur,o un trail de movimiento :
          //ya que lo que hace 
          fin = mix(feedback.rgb,dib,0.2); //ONDA MOTION BLUR
          
          
          //Opcion 2: 
          //Esta opcion es el equivalente a "no refrescar el background" en processing. Lo que estaba queda dibujado.
          //Y lo nuevo se dibuja por encima : 
          fin = mix(feedback.rgb,dib,dib);
          
          //También puedo multiplicar el feedback para que el rastro se vaya yendo a 0.
          //Notese la similitud entre este y la opción 1. Parecidos, no obstante, no iguales.
          //fin = mix(feedback.rgb*.95,dib,dib); 
    
    fragColor = vec4(fin,1.0);
}

#version 150 //Debemos dejar seteada la version en 150.

//8.2
//Feedback
//Operaciones matriciales sobre las uv del feedback : 

//Taller de Livecoding con visuales en GLSL 4.0 

 

uniform float time;
uniform vec2 resolution;

//Declaración del uniform de feedback.
uniform sampler2D prevFrame; 

//FUNCIONES SACADAS DE https://thebookofshaders.com/06/: 
//esta es para transformar si pensamos un color en hsb a rgb, nunca lo use.
vec3 rgb2hsb( in vec3 c ){
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz),
                 vec4(c.gb, K.xy),
                 step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r),
                 vec4(c.r, p.yzx),
                 step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)),
                d / (q.x + e),
                q.x);
}

//  Function from Iñigo Quiles
//  https://www.shadertoy.com/view/MsS3Wc
vec3 hsb2rgb( in vec3 c ){
    vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),
                             6.0)-3.0)-1.0,
                     0.0,
                     1.0 );
    rgb = rgb*rgb*(3.0-2.0*rgb);
    return c.z * mix(vec3(1.0), rgb, c.y);
}

#define PI 3.14159265359
#define TWO_PI PI*2
mat2 scale(vec2 _scale){
    return mat2(_scale.x,0.0,
                0.0,_scale.y);
}
mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}


out vec4 fragColor;

void main(void){
    vec2 uv = gl_FragCoord.xy / resolution;
    
    
    //Las UV que mando dentro de la función texture, me indica como la textura va a "entender" el espacio cartesiano.
    //Es decir como se va a adaptar esa textura a mi pantalla. 
    //Si yo le mando las uv sin modificar veremos el feedback normal
    //Pero si yo le aplico operaciones matriciales solo al feedback tendremos todo una serie nueva de efectos posibles.
    vec2 uv_feedback = uv;
    
    
    //TRANSLATE : 
     //uv_feedback+=vec2(0.00,-0.002); PARA ARRIBA
     //uv_feedback+=vec2(0.00,0.002); //PARA ABAJO
     //uv_feedback+=vec2(0.002,0.0); //PARA IZQUIERDA
     uv_feedback+=vec2(-0.002,0.0); //PARA DERECHA
     
     
     //ROTATE : 
     
     uv_feedback-=vec2(0.5);
     uv_feedback = rotate2d(time*0.0005)*uv_feedback;
     uv_feedback+=vec2(0.5);
     
     
      
     //SCALE : 
     
     uv_feedback-=vec2(0.5);
     //uv_feedback = scale(vec2(0.99))*uv_feedback; //AGRANDA : 
     uv_feedback = scale(vec2(1.01))*uv_feedback; //ACHICA
     uv_feedback+=vec2(0.5);
     
    vec4 feedback = texture(prevFrame,uv_feedback);
    
    //Hago un vector para manejar el movimiento : 
    vec2 mov = vec2(sin(time*0.5)*0.4,cos(time*4)*0.4); //Movimiento complejo
         //mov = vec2(sin(time*4)*0.2,cos(time*4)*0.2); //Movimiento circular
         mov = vec2(sin(time*4)*0.4,cos(time*0.5)*0.4);
    
    
    //Defino la forma: 
    float e = sin(uv.x*100+time*10);
          e = smoothstep(0.88,0.90,1.-length(vec2(0.5)+mov-uv)); //Circulo en una sola linea.
          //e = smoothstep(0.88,0.88,1.-length(vec2(0.5)+mov-uv)); //Circulo sin degrade
           
    //Defino el dibujo (color y forma). 
    vec3 dib = vec3(e) * hsb2rgb(vec3(sin(time)*0.5+0.5,0.8,1.0)); 
    
    
    
    //Feedback mix
    
    vec3  fin = dib;
            
         //Distintas formas de mezclar el feedback : 
         //fin = dib + feedback.rgb*0.99; //opcion 1.A (imagen semiquemada).
         //fin = dib*0.04 + feedback.rgb*0.99;//opcion 1.B(El feedback es el mismo, el dibujo esta multiplicado * 0.1).
        //fin = dib + feedback.rgb*0.6;
          //fin = mix(feedback.rgb,dib,0.2); //ONDA MOTION BLUR
          fin = mix(feedback.rgb,dib,dib);
          //fin = mix(feedback.rgb*.95,dib,dib); 
    
    fragColor = vec4(fin,1.0);
}


#version 150 //Debemos dejar seteada la version en 150.

//8.2
//Feedback
//Operaciones matriciales sobre las uv del feedback : 

//Taller de Livecoding con visuales en GLSL 4.0 

 

uniform float time;
uniform vec2 resolution;

//Declaración del uniform de feedback.
uniform sampler2D prevFrame; 

//FUNCIONES SACADAS DE https://thebookofshaders.com/06/: 
//esta es para transformar si pensamos un color en hsb a rgb, nunca lo use.
vec3 rgb2hsb( in vec3 c ){
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz),
                 vec4(c.gb, K.xy),
                 step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r),
                 vec4(c.r, p.yzx),
                 step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)),
                d / (q.x + e),
                q.x);
}

//  Function from Iñigo Quiles
//  https://www.shadertoy.com/view/MsS3Wc
vec3 hsb2rgb( in vec3 c ){
    vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),
                             6.0)-3.0)-1.0,
                     0.0,
                     1.0 );
    rgb = rgb*rgb*(3.0-2.0*rgb);
    return c.z * mix(vec3(1.0), rgb, c.y);
}

#define PI 3.14159265359
#define TWO_PI PI*2
mat2 scale(vec2 _scale){
    return mat2(_scale.x,0.0,
                0.0,_scale.y);
}
mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}


out vec4 fragColor;

void main(void){
    vec2 uv = gl_FragCoord.xy / resolution;
    
    
    //Otra forma de realizar operaciones complejas con feedback es aplicarle a las transformaciones matriciales de
    //las uv del feedback no solo valores si no mas bien alguna variable donde defina una forma : 
    
    
    //Variable de forma que utilizare para modificar las transformaciones del feedback : 
     
    float fbmodifier = sin(uv.x*2*PI+time
                            +sin(uv.y*10*PI+time
                            +sin(uv.x*5*PI-time 
                            +sin(uv.y*20*PI-time
                            +sin(uv.x*100*PI-time
                            +sin(uv.y*30*PI-time)
                            +sin(uv.x*10*PI-time))))))*0.5+0.5;
    
    //Declaro las uv especificas del feedback.
    vec2 uv_feedback = uv;
    
    
    
     //LE APLICO EL FEEDBACK MODIFIER AL TRANSLATE : 
     //TRANSLATE : 
     //uv_feedback+=vec2(-0.002*fbmodifier,-0.002*fbmodifier); //PARA ARRIBA
     //uv_feedback+=vec2(0.002*fbmodifier,0.002*fbmodifier); //PARA ABAJO
     //uv_feedback+=vec2(0.002*fbmodifier,0.002*fbmodifier); //PARA IZQUIERDA
     //uv_feedback+=vec2(0.002*fbmodifier,0.002*fbmodifier); //PARA DERECHA
     
     
     //ROTATE : 
      //LE APLICO EL FEEDBACK MODIFIER AL ROTATE : 
     uv_feedback-=vec2(0.5);
     //uv_feedback = rotate2d(time*0.00002*fbmodifier)*uv_feedback;
     uv_feedback+=vec2(0.5);
     
     
      
     //SCALE : 
     //LE APLICO EL FEEDBACK MODIFIER AL SCALE : 
     uv_feedback-=vec2(0.5);
     uv_feedback = scale(vec2(1.01-fbmodifier*0.02))*uv_feedback;
     uv_feedback+=vec2(0.5);
     
     
    vec4 feedback = texture(prevFrame,uv_feedback);
    
    //Hago un vector para manejar el movimiento : 
    vec2 mov = vec2(sin(time*0.5)*0.4,cos(time*4)*0.4); //Movimiento complejo
         //mov = vec2(sin(time*4)*0.2,cos(time*4)*0.2); //Movimiento circular
         mov = vec2(sin(time*4)*0.4,cos(time*0.5)*0.4);
    
    
    //Defino la forma: 
    float e = sin(uv.x*100+time*10);
          e = smoothstep(0.88,0.90,1.-length(vec2(0.5)+mov-uv)); //Circulo en una sola linea.
          //e = smoothstep(0.88,0.88,1.-length(vec2(0.5)+mov-uv)); //Circulo sin degrade
           
    //Defino el dibujo (color y forma). 
    vec3 dib = vec3(e) * hsb2rgb(vec3(sin(time)*0.5+0.5,0.8,1.0)); 
    
    
    
    //Feedback mix
    
    vec3  fin = dib;
            
         //Distintas formas de mezclar el feedback : 
         //fin = dib + feedback.rgb*0.99; //opcion 1.A (imagen semiquemada).
         //fin = dib*0.04 + feedback.rgb*0.99;//opcion 1.B(El feedback es el mismo, el dibujo esta multiplicado * 0.1).
        //fin = dib + feedback.rgb*0.6;
          //fin = mix(feedback.rgb,dib,0.2); //ONDA MOTION BLUR
          fin = mix(feedback.rgb,dib,dib);
          //fin = mix(feedback.rgb*.95,dib,dib); 
    
    
    
    //fin = vec3(fbmodifier);//Desmutea esta linea para ver la forma que esta modificando las transformaciones.
    fragColor = vec4(fin,1.0);
}


#version 150 //Debemos dejar seteada la version en 150.

//8.2
//Feedback
//Operaciones matriciales sobre las uv del feedback : 

//Taller de Livecoding con visuales en GLSL 4.0 

 

uniform float time;
uniform vec2 resolution;

//Declaración del uniform de feedback.
uniform sampler2D prevFrame; 

//FUNCIONES SACADAS DE https://thebookofshaders.com/06/: 
//esta es para transformar si pensamos un color en hsb a rgb, nunca lo use.
vec3 rgb2hsb( in vec3 c ){
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz),
                 vec4(c.gb, K.xy),
                 step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r),
                 vec4(c.r, p.yzx),
                 step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)),
                d / (q.x + e),
                q.x);
}

//  Function from Iñigo Quiles
//  https://www.shadertoy.com/view/MsS3Wc
vec3 hsb2rgb( in vec3 c ){
    vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),
                             6.0)-3.0)-1.0,
                     0.0,
                     1.0 );
    rgb = rgb*rgb*(3.0-2.0*rgb);
    return c.z * mix(vec3(1.0), rgb, c.y);
}

#define PI 3.14159265359
#define TWO_PI PI*2
mat2 scale(vec2 _scale){
    return mat2(_scale.x,0.0,
                0.0,_scale.y);
}
mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}

//LIMIT AND DEC  : 
vec3 limitanddec(vec3 col, vec3 limit, vec3 dec){
    if(col.r > limit.r){
        col.r -=dec.r;
    }

    if(col.g > limit.g){
        col.g -=dec.g;
    }
    if(col.b > limit.b){
        col.b -=dec.b;
    }

    return col;
}


out vec4 fragColor;

void main(void){
    vec2 uv = gl_FragCoord.xy / resolution;
        
    //Variable de forma que utilizare para modificar las transformaciones del feedback : 
     
    vec4 feedback = texture(prevFrame,uv);
    
    //Hago un vector para manejar el movimiento : 
    vec2 mov = vec2(sin(time*0.5)*0.4,cos(time*4)*0.4); //Movimiento complejo
         //mov = vec2(sin(time*4)*0.2,cos(time*4)*0.2); //Movimiento circular
         mov = vec2(sin(time*4)*0.4,cos(time*0.5)*0.4);
    
    //Defino la forma: 
    float e = sin(uv.x*100+time*10);
          e = smoothstep(0.88,0.90,1.-length(vec2(0.5)+mov-uv)); //Circulo en una sola linea.
          //e = smoothstep(0.88,0.88,1.-length(vec2(0.5)+mov-uv)); //Circulo sin degrade
           
    //Defino el dibujo (color y forma). 
    vec3 dib = vec3(e) ; 
    

    //Feedback mix
    
    vec3  fin = dib;
            
         //Distintas formas de mezclar el feedback : 
         //fin = dib + feedback.rgb*1.0; //opcion 1.A (imagen semiquemada).
         fin = dib*0.02 + feedback.rgb*1.0;//opcion 1.B(El feedback es el mismo, el dibujo esta multiplicado * 0.1).
        //fin = dib + feedback.rgb*0.6;
          //fin = mix(feedback.rgb,dib,0.2); //ONDA MOTION BLUR
          //fin = mix(feedback.rgb,dib,dib);
          //fin = mix(feedback.rgb*.95,dib,dib); 
    
    
    //Otra opción para evitar que se queme pero que genera una estetica onda noise es establecer un limite de valor
    // y si supera ese valor entonces que le reste otro valor. 
    
    
    
    //En este caso. Si la cantidad de blanco supera 0.9, entonces le resta 0.9 : 
    fin = limitanddec(fin,vec3(0.9),vec3(0.9));
    
    //Tira valores distintos a los valores distintos en los 3 canales y me genera una paleta experimental :
     //fin = limitanddec(fin,vec3(0.7,0.5,0.9),vec3(0.1,0.8,0.8)); 
    
    
    fragColor = vec4(fin,1.0);
}

#version 150 //Debemos dejar seteada la version en 150.

//8.2
//Feedback
//Operaciones matriciales sobre las uv del feedback : 

//Taller de Livecoding con visuales en GLSL 4.0 

 

uniform float time;
uniform vec2 resolution;

//Declaración del uniform de feedback.
uniform sampler2D prevFrame; 

//FUNCIONES SACADAS DE https://thebookofshaders.com/06/: 
//esta es para transformar si pensamos un color en hsb a rgb, nunca lo use.
vec3 rgb2hsb( in vec3 c ){
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz),
                 vec4(c.gb, K.xy),
                 step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r),
                 vec4(c.r, p.yzx),
                 step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)),
                d / (q.x + e),
                q.x);
}

//  Function from Iñigo Quiles
//  https://www.shadertoy.com/view/MsS3Wc
vec3 hsb2rgb( in vec3 c ){
    vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),
                             6.0)-3.0)-1.0,
                     0.0,
                     1.0 );
    rgb = rgb*rgb*(3.0-2.0*rgb);
    return c.z * mix(vec3(1.0), rgb, c.y);
}

#define PI 3.14159265359
#define TWO_PI PI*2
mat2 scale(vec2 _scale){
    return mat2(_scale.x,0.0,
                0.0,_scale.y);
}
mat2 rotate2d(float _angle){
    return mat2(cos(_angle),-sin(_angle),
                sin(_angle),cos(_angle));
}

//LIMIT AND DEC  : 
vec3 limitanddec(vec3 col, vec3 limit, vec3 dec){
    if(col.r > limit.r){
        col.r -=dec.r;
    }

    if(col.g > limit.g){
        col.g -=dec.g;
    }
    if(col.b > limit.b){
        col.b -=dec.b;
    }

    return col;
}


out vec4 fragColor;

void main(void){
    vec2 uv = gl_FragCoord.xy / resolution;
        
    //Variable de forma que utilizare para modificar las transformaciones del feedback : 
     
    vec4 feedback = texture(prevFrame,uv);
    
    //Hago un vector para manejar el movimiento : 
    vec2 mov = vec2(sin(time*0.5)*0.4,cos(time*4)*0.4); //Movimiento complejo
         //mov = vec2(sin(time*4)*0.2,cos(time*4)*0.2); //Movimiento circular
         mov = vec2(sin(time*4)*0.4,cos(time*0.5)*0.4);
    
    //Defino la forma: 
    float e = sin(uv.x*100+time*10);
          e = smoothstep(0.88,0.90,1.-length(vec2(0.5)+mov-uv)); //Circulo en una sola linea.
          //e = smoothstep(0.88,0.88,1.-length(vec2(0.5)+mov-uv)); //Circulo sin degrade
           
    //Defino el dibujo (color y forma). 
    vec3 dib = vec3(e) ; 
    

    //Feedback mix
    
    vec3  fin = dib;
            
    float forma2 = sin(uv.x*20*PI+time
                        +sin(uv.y*1*PI+time
                        +sin(uv.x*10*PI-time 
                        +sin(uv.y*20*PI-time
                        +sin(uv.x*10*PI-time
                        +sin(uv.y*10*PI-time)
                        +sin(uv.x*10*PI-time))))))*0.5+0.5;
     
     vec3 col = vec3(sin(uv.x*30000+time)*0.5+0.5,cos(uv.y*300+time)*0.5+0.5,0.5);
     
     vec3 fbmodifier = vec3(forma2) * col;
     
     
     //Otro truco que podemos utilizar para el feedback es multiplicar la cantidad de feedback por otro dibujo. 
     //En este caso "fbmodifier" es otra visual que tenemos , y el circulo pinta su feedback en relación a eso.
     //Y genera este efecto. 
     
     //Este efecto es particularmente util con imagenes y videos en donde queremos hacer como una especie de 
     //"mascara" que permita descubrir la imagen de atras". 
     
     
     
     
     fin = dib + (feedback.rgb*1.2*(fbmodifier));
      
      
     //Pruebas de lo mismo pero utilizando mix : 
     //fin = mix(feedback.rgb,dib,dib*fbmodifier);
     //fin = mix(feedback.rgb,dib*fbmodifier,dib);
    
    fragColor = vec4(fin,1.0);
}


#version 150

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;
uniform sampler2D texture3;
uniform sampler2D prevFrame;
uniform sampler2D prevPass;

in VertexData
{
    vec4 v_position;
    vec3 v_normal;
    vec2 v_texcoord;
} inData;

out vec4 fragColor;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 permute(vec4 x) { return mod((34.0 * x + 1.0) * x, 289.0);}
vec3 hash3( vec2 p ) {
    vec3 q = vec3( dot(p,vec2(127.1,311.7)),
                   dot(p,vec2(269.5,183.3)),
                   dot(p,vec2(419.2,371.9)) );
    return fract(sin(q)*43758.5453);
}

vec2 random2( vec2 p ) {
    return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);
}
float random (in vec2 _st) {
    return fract(sin(dot(floor(_st.xy),
                         vec2(12.9898,78.233)))*
        43000.3);
}

float random (in vec2 _st,in float _time) {
    return fract(sin(dot(floor(_st.xy),
                         vec2(12.9898,78.233)))*
        43000.3+_time);
}


float noise (in vec2 st,float fase) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    
    float fase2 = fase;
    // Four corners in 2D of a tile
    float a = sin(random(i)*fase2);
    float b =  sin(random(i + vec2(1.0, 0.0))*fase2);
    float c =  sin(random(i + vec2(0.0, 1.0))*fase2);
    float d =  sin(random(i + vec2(1.0, 1.0))*fase2);

    // Smooth Interpolation

    // Cubic Hermine Curve.  Same as SmoothStep()
    vec2 u = f*f*(3.0-2.0*f);
    // u = smoothstep(0.,1.,f);

    // Mix 4 coorners percentages
    return mix(a, b, u.x) +
            (c - a)* u.y * (1.0 - u.x) +
            (d - b) * u.x * u.y;
}


float snoise(vec2 v) {

    // Precompute values for skewed triangular grid
    const vec4 C = vec4(0.211324865405187,
                        // (3.0-sqrt(3.0))/6.0
                        0.366025403784439,
                        // 0.5*(sqrt(3.0)-1.0)
                        -0.577350269189626,
                        // -1.0 + 2.0 * C.x
                        0.024390243902439);
                        // 1.0 / 41.0

    // First corner (x0)
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);

    // Other two corners (x1, x2)
    vec2 i1 = vec2(0.0);
    i1 = (x0.x > x0.y)? vec2(1.0, 0.0):vec2(0.0, 1.0);
    vec2 x1 = x0.xy + C.xx - i1;
    vec2 x2 = x0.xy + C.zz;

    // Do some permutations to avoid
    // truncation effects in permutation
    i = mod289(i);
    vec3 p = permute(
            permute( i.y + vec3(0.0, i1.y, 1.0))
                + i.x + vec3(0.0, i1.x, 1.0 ));

    vec3 m = max(0.5 - vec3(
                        dot(x0,x0),
                        dot(x1,x1),
                        dot(x2,x2)
                        ), 0.0);

    m = m*m ;
    m = m*m ;

    // Gradients:
    //  41 pts uniformly over a line, mapped onto a diamond
    //  The ring size 17*17 = 289 is close to a multiple
    //      of 41 (41*7 = 287)

    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;

    // Normalise gradients implicitly by scaling m
    // Approximation of: m *= inversesqrt(a0*a0 + h*h);
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0+h*h);

    // Compute final noise value at P
    vec3 g = vec3(1);
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * vec2(x1.x,x2.x) + h.yz * vec2(x1.y,x2.y) ;
    return 20.0 * dot(m, g);
}


//Simple voronoi : 
float voronoi(vec2 uv){
 // Scale
   // uv *= 10.;

    // Tile the space
    vec2 i_st = floor(uv);
    vec2 f_st = fract(uv);

    float m_dist = uv.x;  // minimun distance
    vec2 m_point;        // minimum point

    for (int j=-1; j<=1; j++ ) {
        for (int i=-1; i<=1; i++ ) {
            vec2 neighbor = vec2(float(i),float(j));
            vec2 point = vec2(random(i_st + neighbor));
            point = 0.5 + 0.5*sin(time + 6.2831*point);
            vec2 diff = neighbor + point - f_st;
            float dist = length(diff);

            if( dist < m_dist ) {
                m_dist = dist;
                m_point = point;
            }
        }
    }
    
    return dot(m_point,vec2(.1,1.0));
}

vec3 voronoi2( in vec2 x ,float time) {
    vec2 n = floor(x);
    vec2 f = fract(x);

    // first pass: regular voronoi
    vec2 mg, mr;
    float md = 8.0;
    for (int j= -1; j <= 1; j++) {
        for (int i= -1; i <= 1; i++) {
            vec2 g = vec2(float(i),float(j));
            vec2 o = random2( n + g );
            o = 0.5 + 0.5*sin( time + 6.2831*o );

            vec2 r = g + o - f;
            float d = dot(r,r);

            if( d<md ) {
                md = d;
                mr = r;
                mg = g;
            }
        }
    }

    // second pass: distance to borders
    md = 8.0;
    for (int j= -2; j <= 2; j++) {
        for (int i= -2; i <= 2; i++) {
            vec2 g = mg + vec2(float(i),float(j));
            vec2 o = random2( n + g );
            o = 0.5 + 0.5*sin( time + 6.2831*o );

            vec2 r = g + o - f;

            if ( dot(mr-r,mr-r)>0.00001 ) {
                md = min(md, dot( 0.5*(mr+r), normalize(r-mr) ));
            }
        }
    }
    return vec3(md, mr);
}


vec2 cellular2x2x2(vec3 P) {
    #define K 0.142857142857 // 1/7
    #define Ko 0.428571428571 // 1/2-K/2
    #define K2 0.020408163265306 // 1/(7*7)
    #define Kz 0.166666666667 // 1/6
    #define Kzo 0.416666666667 // 1/2-1/6*2
    #define jitter 0.8 // smaller jitter gives less errors in F2
    vec3 Pi = mod(floor(P), 289.0);
    vec3 Pf = fract(P);
    vec4 Pfx = Pf.x + vec4(0.0, -1.0, 0.0, -1.0);
    vec4 Pfy = Pf.y + vec4(0.0, 0.0, -1.0, -1.0);
    vec4 p = permute(Pi.x + vec4(0.0, 1.0, 0.0, 1.0));
    p = permute(p + Pi.y + vec4(0.0, 0.0, 1.0, 1.0));
    vec4 p1 = permute(p + Pi.z); // z+0
    vec4 p2 = permute(p + Pi.z + vec4(1.0)); // z+1
    vec4 ox1 = fract(p1*K) - Ko;
    vec4 oy1 = mod(floor(p1*K), 7.0)*K - Ko;
    vec4 oz1 = floor(p1*K2)*Kz - Kzo; // p1 < 289 guaranteed
    vec4 ox2 = fract(p2*K) - Ko;
    vec4 oy2 = mod(floor(p2*K), 7.0)*K - Ko;
    vec4 oz2 = floor(p2*K2)*Kz - Kzo;
    vec4 dx1 = Pfx + jitter*ox1;
    vec4 dy1 = Pfy + jitter*oy1;
    vec4 dz1 = Pf.z + jitter*oz1;
    vec4 dx2 = Pfx + jitter*ox2;
    vec4 dy2 = Pfy + jitter*oy2;
    vec4 dz2 = Pf.z - 1.0 + jitter*oz2;
    vec4 d1 = dx1 * dx1 + dy1 * dy1 + dz1 * dz1; // z+0
    vec4 d2 = dx2 * dx2 + dy2 * dy2 + dz2 * dz2; // z+1

    // Sort out the two smallest distances (F1, F2)
#if 0
    // Cheat and sort out only F1
    d1 = min(d1, d2);
    d1.xy = min(d1.xy, d1.wz);
    d1.x = min(d1.x, d1.y);
    return sqrt(d1.xx);
#else
    // Do it right and sort out both F1 and F2
    vec4 d = min(d1,d2); // F1 is now in d
    d2 = max(d1,d2); // Make sure we keep all candidates for F2
    d.xy = (d.x < d.y) ? d.xy : d.yx; // Swap smallest to d.x
    d.xz = (d.x < d.z) ? d.xz : d.zx;
    d.xw = (d.x < d.w) ? d.xw : d.wx; // F1 is now in d.x
    d.yzw = min(d.yzw, d2.yzw); // F2 now not in d2.yzw
    d.y = min(d.y, d.z); // nor in d.z
    d.y = min(d.y, d.w); // nor in d.w
    d.y = min(d.y, d2.x); // F2 is now in d.y
    return sqrt(d.xy); // F1 and F2
#endif
}

float iqnoise( in vec2 x, float u, float v ) {
    vec2 p = floor(x);
    vec2 f = fract(x);

    float k = 1.0+63.0*pow(1.0-v,4.0);

    float va = 0.0;
    float wt = 0.0;
    for (int j=-2; j<=2; j++) {
        for (int i=-2; i<=2; i++) {
            vec2 g = vec2(float(i),float(j));
            vec3 o = hash3(p + g)*vec3(u,u,1.0);
            vec2 r = g - f + o.xy;
            float d = dot(r,r);
            float ww = pow( 1.0-smoothstep(0.0,1.414,sqrt(d)), k );
            va += o.z*ww;
            wt += ww;
        }
    }

    return va/wt;
}

#define OCTAVES 6
float fbm (in vec2 st) {
    // Initial values
    float value = 0.0;
    float amplitude = .5;
    float frequency = 0.;
    //
    // Loop of octaves
    for (int i = 0; i < OCTAVES; i++) {
        value += amplitude * noise(st,time);
        st *= 2.;
        amplitude *= .5;
    }
    return value;
}


float fbm (in vec2 st,float _t) {
    // Initial values
    float value = 0.0;
    float amplitude = .5;
    float frequency = 0.;
    //
    // Loop of octaves
    for (int i = 0; i < OCTAVES; i++) {
        value += amplitude * noise(st,_t);
        st *= 2.;
        amplitude *= .5;
    }
    return value;
}
// Ridged multifractal
// See "Texturing & Modeling, A Procedural Approach", Chapter 12
float ridge(float h, float offset) {
    h = abs(h);     // create creases
    h = offset - h; // invert so creases are at top
    h = h * h;      // sharpen creases
    return h;
}

float ridgedMF(vec2 p) {
    float lacunarity = 2.0;
    float gain = 0.5;
    float offset = 0.9;

    float sum = 0.0;
    float freq = 1.0, amp = 0.5;
    float prev = 1.0;
    for(int i=0; i < OCTAVES; i++) {
        float n = ridge(snoise(p*freq), offset);
        sum += n*amp;
        sum += n*amp*prev;  // scale by previous octave
        prev = n;
        freq *= lacunarity;
        amp *= gain;
    }
    return sum;
}
float rxr(vec2 uv){
    float e = 0.;
    e = ridgedMF(vec2(ridgedMF(vec2(uv.x,uv.y))));
    return e*1.5-1.5;
    
}
void main(void){
    vec2 uv = gl_FragCoord.xy/resolution;
    
    //PATRONES GENERATIVOS : 
    
    
    
    float forma = random(uv*10,time*0.2);
    forma = random(uv*10,time*0.2);
         forma = noise(uv*10,time);
         forma = snoise(uv*10)*10+0.2;
         //forma = voronoi(uv*10);
         
          //Sacado de aca : https://thebookofshaders.com/edit.php#12/2d-cnoise-2x2x2.frag
         //forma = cellular2x2x2(vec3(uv*10,time*0.2)).x; //VORONOI:
         //forma = iqnoise(uv*10, sin(time)*0.5+0.5,sin(time)*0.5+0.5);
        
         //forma = fbm(uv*3+time+fbm(uv*10+fbm(uv*20))) ;
         forma = ridgedMF(uv*3+time)*1.5-1.5;
         //forma = 1.-forma;
         //forma = rxr(vec2(uv.x,uv.y-time));
         
         
         
         
    vec3 fin = vec3(forma);
    fragColor = vec4(fin,1.0);
}

#version 150

// EJEMPLO 1 - FRACTAL ABS+SCALE+ROT CON COLOREADO SIMPLE POR VALOR COORDENADAS

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;

out vec4 fragColor;

// función rotar, a = angulo en radianes, 
// devuelve matriz de rotación para multiplicar por las coordenadas
mat2 rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, s, -s, c);
}

// fractal - recibe las coordenadas e itera la fórmula en el for
vec3 fractal(vec2 p) {
    p *= 2.; // zoom out
    for (int i = 0; i < 12; i++) {
        p *= rot(time * .1); // rotación variable
        p = abs(p); // espejo en x e y
        p *= 1.5; // escala
        p -= 1.; // translación
    }
    // usamos las coordenadas resultantes para colorear
    return vec3(p.x, p.y, length(p)*.5)*1.5;
}


void main(void)
{
    vec2 uv = gl_FragCoord.xy / resolution - .5;
    uv.x *= resolution.x / resolution.y;
    vec3 col = fractal(uv);
    fragColor = vec4(col,1.);
}


#version 150

// EJEMPLO 2 - FRACTAL ABS+SCALE+ROT 
// IGUAL AL ANTERIOR CON OTRA TECNICA DE COLOREADO: SUMA DE LAS DIFERENCIAS
// COMPARAR CON EL SHADER ANTERIOR ACTIVANDO Y DESACTIVANDO LA PESTAÑA

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;
uniform sampler2D texture3;
uniform sampler2D prevFrame;
uniform sampler2D prevPass;

in VertexData
{
    vec4 v_position;
    vec3 v_normal;
    vec2 v_texcoord;
} inData;

out vec4 fragColor;

// función rotar, a = angulo en radianes, 
// devuelve matriz de rotación para multiplicar por las coordenadas
mat2 rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, s, -s, c);
}

// fractal - recibe las coordenadas e itera la fórmula en el for
vec3 fractal(vec2 p) {
    p *= 2.; // zoom out
    float lprev = length(p); // length inicial
    float res = 0.; // resultado
    for (float i = 0.; i < 12; i++) {
        p *= rot(time * .1); // rotación variable
        p = abs(p); // espejo en x e y
        p *= 1.5 ; // escala variable por fract de tiempo
        p -= 1.; // translación
        float l = length(p); // length actual
        res += abs(l - lprev); // acumula diferencia entre lenght anterior y actual
        lprev = l; // guarda el length actual
    }
    res *= .1; // achico el resultado
    // armo color con el resultado y una coordenada
    vec3 col = vec3(res, res*res, p.x*p.x); 
    return col;
}


void main(void)
{
    vec2 uv = gl_FragCoord.xy / resolution - .5;
    uv.x *= resolution.x / resolution.y;
    vec3 col = fractal(uv);
    fragColor = vec4(col,1.);
}


#version 150

// EJEMPLO 3 - FRACTAL ABS+SCALE+ROT 
// TECNICA DE COLOREADO: ROTAR RGB SEGUN SUMA DE LAS DIFERENCIAS

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;
uniform sampler2D texture3;
uniform sampler2D prevFrame;
uniform sampler2D prevPass;

in VertexData
{
    vec4 v_position;
    vec3 v_normal;
    vec2 v_texcoord;
} inData;

out vec4 fragColor;

// función rotar, a = angulo en radianes, 
// devuelve matriz de rotación para multiplicar por las coordenadas
mat2 rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, s, -s, c);
}

// fractal - recibe las coordenadas e itera la fórmula en el for
vec3 fractal(vec2 p) {
    p *= 2.5; // zoom out
    float lprev = length(p); // length inicial
    float res = 0.; // resultado
    for (float i = 0.; i < 20; i++) {
        p *= rot(.3); // rotación fija
        p = abs(p); // espejo en x e y
        p *= 1.35 - fract(time * .1) * .2; // escala variable por fract de tiempo
        p -= vec2(2., 1.); // translación
        float l = length(p); // length actual
        res += abs(l - lprev); // acumula diferencia entre lenght anterior y actual
        lprev = l; // guarda el length actual
    }
    vec3 col = vec3(0., 0., 1.); // color base
    col.rb *= rot(res * .5); // roto la paleta segun resultado
    return col;
}


void main(void)
{
    vec2 uv = gl_FragCoord.xy / resolution - .5;
    uv.x *= resolution.x / resolution.y;
    vec3 col = fractal(uv);
    fragColor = vec4(col,1.);
}

#version 150

// EJEMPLO 4 - FRACTAL ABS+SCALE+ROT 
// TECNICA DE COLOREADO: SUMA DE LAS DIFERENCIAS
// COLOREADO FINAL: SENO DEL RESULTADO + CREACION DE PALETA SIMPLE

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;
uniform sampler2D texture3;
uniform sampler2D prevFrame;
uniform sampler2D prevPass;

in VertexData
{
    vec4 v_position;
    vec3 v_normal;
    vec2 v_texcoord;
} inData;

out vec4 fragColor;

// función rotar, a = angulo en radianes, 
// devuelve matriz de rotación para multiplicar por las coordenadas
mat2 rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, s, -s, c);
}

// fractal - recibe las coordenadas e itera la fórmula en el for
vec3 fractal(vec2 p) {
    p *= 4.5; // zoom out
    p.y += .75; // offset y
    float lprev = length(p); // length inicial
    float res = 0.; // resultado
    for (float i = 0.; i < 41; i++) {
        p.x = abs(p.x); // espejo en x
        p *= rot(-.7); // rotación fija
        p *= 1.4; // escala variable por fract de tiempo
        p -= vec2(0., 1.); // translación
        float l = length(p); // length actual
        res += abs(l - lprev); // acumula diferencia entre lenght anterior y actual
        lprev = l; // guarda el length actual
    }
    res *= .00002; // escalar resultado
    res = sin(res + time); // sin + time sobre resultado
    return vec3(res*2., res*res, 0.) + p.x*.000002; // armo color con resultado y posicion final x
}


void main(void)
{
    vec2 uv = gl_FragCoord.xy / resolution - .5;
    uv.x *= resolution.x / resolution.y;
    vec3 col = fractal(uv);
    fragColor = vec4(col,1.);
}


#version 150

// EJEMPLO 5 - FRACTAL ABS+INVERSION 
// TECNICA DE COLOREADO: SUMA DE DIFERENCIAS - CONVERSION HSV A RGB - VARIACION DE BRILLO RADIAL

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;
uniform sampler2D texture3;
uniform sampler2D prevFrame;
uniform sampler2D prevPass;

in VertexData
{
    vec4 v_position;
    vec3 v_normal;
    vec2 v_texcoord;
} inData;

out vec4 fragColor;


vec3 hsv2rgb(vec3 c)
{
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// fractal - recibe las coordenadas e itera la fórmula en el for
vec3 fractal(vec2 p) {
    float lprev = length(p); // length inicial
    float len = lprev; // guardo el length 
    float res = 0.; // resultado
    for (float i = 0.; i < 20; i++) {
        p = abs(p); // espejo en x
        p /= dot(p,p); // Inversión circular
        p -= .5; // translación
        float l = length(p); // length actual
        res += abs(l - lprev); // acumula diferencia entre lenght anterior y actual
        lprev = l; // guarda el length actual
    }
    res *= .015; // escalar resultado
    return hsv2rgb(vec3(res, .7, 1.)) // obtengo rgb desde hsv usando res como hue
    * fract(len * 5. + res - time * .5); // el fract del length original, sumado al resultado del fractal
                                    // y restando time, genera las ondas radiales que se expanden
}


void main(void)
{
    vec2 uv = gl_FragCoord.xy / resolution - .5;
    uv.x *= resolution.x / resolution.y;
    vec3 col = fractal(uv);
    fragColor = vec4(col,1.);
}


#version 150

// EJEMPLO 6 - FRACTAL BOXFOLD+SCALE+BALLFOLD (estilo Mandelbox)
// TECNICA DE COLOREADO: SUMA DE DIFERENCIAS - COORDENADA X 

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;
uniform sampler2D texture3;
uniform sampler2D prevFrame;
uniform sampler2D prevPass;

in VertexData
{
    vec4 v_position;
    vec3 v_normal;
    vec2 v_texcoord;
} inData;

out vec4 fragColor;


vec3 hsv2rgb(vec3 c)
{
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// fractal - recibe las coordenadas e itera la fórmula en el for
vec3 fractal(vec2 p) {
    float lprev = length(p); // length inicial
    float res = 0.; // resultado
    p *= 1. + sin(time * .2) * .5; // zoom
    p += vec2(sin(time * .3) , time * .1);
    p = abs(1. - mod(p * .1, 2.));
    for (float i = 0.; i < 11; i++) {
        p = abs(p + 1.) - abs(p - 1.) - p; // boxfold
        p *= 2.; // escala
        p /= clamp(dot(p,p), .5, 1.); // ballfold
        p -= 1.; // translación
        float l = length(p); // length actual
        res += abs(l - lprev); // acumula diferencia entre lenght anterior y actual
        lprev = l; // guarda el length actual
    }
    res *= .05; // escalo res
    res *= res * res; // contraste
    res -= p.x * .1; // restar p.x genera los "surcos"
    return vec3(res, res*res, res*res*res); // armo rgb con res
}


void main(void)
{
    vec2 uv = gl_FragCoord.xy / resolution - .5;
    uv.x *= resolution.x / resolution.y;
    vec3 col = fractal(uv);
    fragColor = vec4(col,1.);
}


#version 150

// EJEMPLO 7 - FRACTAL ABS+INVERSION 
// TECNICA DE COLOREADO: ORBIT TRAPS

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;
uniform sampler2D texture3;
uniform sampler2D prevFrame;
uniform sampler2D prevPass;

in VertexData
{
    vec4 v_position;
    vec3 v_normal;
    vec2 v_texcoord;
} inData;

out vec4 fragColor;


// función rotar, a = angulo en radianes, 
// devuelve matriz de rotación para multiplicar por las coordenadas
mat2 rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, s, -s, c);
}

// fractal - recibe las coordenadas e itera la fórmula en el for
vec3 fractal(vec2 p) {
    float ot = 1000.; // orbit trap se inicializa en valor alto
    p *= rot(time * .2);
    float zoom = 1. + sin(time * .3) * .95; // zoom 
    p *= zoom * .005; // aplico zoom
    p += .5;
    for (float i = 0.; i < 50. - zoom * 8.; i++) { // iteraciones variables segun zoom
        p.x = abs(p.x); // espejo en x
        p /= dot(p,p); // Inversión circular
        p -= vec2(.5, .25); // translación
        ot = min(ot, length(p)); // captura el valor mas cercano a 0,0 en ot (orbit trap)
    }
    ot = exp(-8. * ot); // exp negativo invierte ot y le da contraste (comprime)
    return vec3(ot * ot, ot * ot * ot, ot * 4.); // creo rgb con ot
}


void main(void)
{
    vec2 uv = gl_FragCoord.xy / resolution - .5;
    uv.x *= resolution.x / resolution.y;
    vec3 col = fractal(uv);
    fragColor = vec4(col,1.);
}


#version 150

// EJEMPLO 8 - FRACTAL BOXFOLD+BALLFOLD (estilo Mandelbox) 
// TECNICA DE COLOREADO: ORBIT TRAPS ANIMADAS - COLOR POR ITERACION

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;
uniform sampler2D texture3;
uniform sampler2D prevFrame;
uniform sampler2D prevPass;

in VertexData
{
    vec4 v_position;
    vec3 v_normal;
    vec2 v_texcoord;
} inData;

out vec4 fragColor;


// función rotar, a = angulo en radianes, 
// devuelve matriz de rotación para multiplicar por las coordenadas
mat2 rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, s, -s, c);
}

vec3 hsv2rgb(vec3 c)
{
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}


// fractal - recibe las coordenadas e itera la fórmula en el for
vec3 fractal(vec2 p) {
    float ot = 1000.; // orbit trap se inicializa en valor alto
    float it = 0.; // para guardar la iteracion del orbit trap
    p *= rot(time * .2); // rotacion de 'camara'
    p *= .2; // zoom in
    for (float i = 0.; i < 10.; i++) { // iteraciones variables segun zoom
        p = abs(p + 1.) - abs(p - 1.) - p; // boxfold
        p /= clamp(dot(p,p), .0, 2.); // ballfold
        p *= 1.5; // escala
        p -= vec2(1., 3.); // translación
        float v = abs(p.x) + abs(sin(p.y * .5 + time * 3.)) * .5; // para capturar el valor más cercano al eje x
                                                    // y animado sumando un valor absoluto del seno del eje y con time
        if (v < ot) // no uso min ya que quiero capturar la iteracion tambien, si el valor v es menor...
        {
            ot = v; // guardo el valor menor en ot
            it = i; // guardo la iteracion 
        }
        
    }
    ot = exp(-7. * ot); // exp negativo invierte ot y le da contraste (comprime)
    return hsv2rgb(vec3(it*.2,.7, 4.)) * ot; // creo rgb con hsv usando iteracion guardada multiplicada por ot
}


void main(void)
{
    vec2 uv = gl_FragCoord.xy / resolution - .5;
    uv.x *= resolution.x / resolution.y;
    vec3 col = fractal(uv);
    fragColor = vec4(col,1.);
}


#version 150

// EJEMPLO 9 - FRACTAL BOXFOLD + COUSINFOLD 
// TECNICA DE COLOREADO: ORBIT TRAPS ANIMADAS - COLOR POR ITERACION

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;
uniform sampler2D texture3;
uniform sampler2D prevFrame;
uniform sampler2D prevPass;

in VertexData
{
    vec4 v_position;
    vec3 v_normal;
    vec2 v_texcoord;
} inData;

out vec4 fragColor;


// función rotar, a = angulo en radianes, 
// devuelve matriz de rotación para multiplicar por las coordenadas
mat2 rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, s, -s, c);
}

vec3 hsv2rgb(vec3 c)
{
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}


// fractal - recibe las coordenadas e itera la fórmula en el for
vec3 fractal(vec2 p) {
    float ot = 1000.; // orbit trap se inicializa en valor alto
    float it = 0.; // para guardar la iteracion del orbit trap
    p += time * .1; // movimiento camara
    p *= 3.; // zoom out
    p = mod(p, 3.); // mosaico para repetir el patron
    for (float i = 0.; i < 8.; i++) { // iteraciones variables segun zoom
        p = abs(p + .5) - abs(p - .5) - p; // boxfold
        p /= clamp(p.x * p.y, .25, 1.); // cousinfold
        p *= .5; // escala
        p -= 1.; // translación
        float v = abs(p.x) + fract(p.y * .2 + time * .5 + i * .15) * .5; // para capturar el valor más cercano al eje x
                            // y animar sumando fract de p.y y time, ademas de la iteracion actual para desfasar 
        if (v < ot) // no uso min ya que quiero capturar la iteracion tambien, si el valor v es menor...
        {
            ot = v; // guardo el valor menor en ot
            it = i; // guardo la iteracion 
        }
        
    }
    ot = exp(-10. * ot); // exp negativo invierte ot y le da contraste (comprime)
    return hsv2rgb(vec3(it*.1,.7,2.)) * ot + length(p) *.005 ; // creo rgb con hsv usando de hue iteracion guardada 
                        //luego multiplicado por orbit trap y sumando length de las coordenadas finales (blanco)
}


void main(void)
{
    vec2 uv = gl_FragCoord.xy / resolution - .5;
    uv.x *= resolution.x / resolution.y;
    uv.x *= 1.+uv.y; // deformacion de uv.x para simular perspectiva
    vec3 col = fractal(uv);
    fragColor = vec4(col,1.);
}

#version 150

// EJEMPLO 10 - FRACTAL BOXFOLD + BALLFOLD 
// TECNICA DE COLOREADO: ORBIT TRAPS ANIMADAS - COLOR POR ITERACION

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;


out vec4 fragColor;


// función rotar, a = angulo en radianes, 
// devuelve matriz de rotación para multiplicar por las coordenadas
mat2 rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, s, -s, c);
}

vec3 hsv2rgb(vec3 c)
{
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}


// fractal - recibe las coordenadas e itera la fórmula en el for
vec3 fractal(vec2 p) {
    float ot = 1000.; // orbit trap se inicializa en valor alto
    float it = 0.; // para guardar la iteracion del orbit trap
    p *= 5.+sin(time * .2)*4.5; // zoom out
    for (float i = 0.; i < 20.; i++) { // iteraciones variables segun zoom
        p = abs(p); // boxfold
        p *= rot(-.7); // rotación fija
        p /= clamp(dot(p,p), .0, 1.5); // ballfold
        p -= .25; // translación
        // para capturar el valor más cercano a los ejes x o y
        // y animar sumando fract de p.y y time, ademas de la iteracion actual para desfasar 
        float v = min(abs(p.x), abs(p.y)) + fract(p.y * .1 + time + i * .2) * .5; 
        if (v < ot) // no uso min ya que quiero capturar la iteracion tambien, si el valor v es menor...
        {
            ot = v; // guardo el valor menor en ot
            it = i; // guardo la iteracion 
        }
        
    }
    ot = exp(-30. * ot); // exp negativo invierte ot y le da contraste (comprime)
    return hsv2rgb(vec3(it*.05,.7,2.)) * ot + length(p) *.005 ; // creo rgb con hsv usando de hue iteracion guardada 
                        //luego multiplicado por orbit trap y sumando length de las coordenadas finales (blanco)
}


void main(void)
{
    vec2 uv = gl_FragCoord.xy / resolution - .5;
    uv.x *= resolution.x / resolution.y;
    vec3 col = fractal(uv);
    fragColor = vec4(col,1.);
}


#version 150

// EJEMPLO 9 - FRACTAL BOXFOLD + COUSINFOLD 
// TECNICA DE COLOREADO: ORBIT TRAPS ANIMADAS - COLOR POR ITERACION

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;



out vec4 fragColor;


// función rotar, a = angulo en radianes, 
// devuelve matriz de rotación para multiplicar por las coordenadas
mat2 rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, s, -s, c);
}

vec3 hsv2rgb(vec3 c)
{
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}


// fractal - recibe las coordenadas e itera la fórmula en el for
vec3 fractal(vec2 p) {
    float ot = 1000.; // orbit trap se inicializa en valor alto
    float it = 0.; // para guardar la iteracion del orbit trap
    p += time * .1; // movimiento camara
    p *= 3.; // zoom out
    p = mod(p, 3.); // mosaico para repetir el patron
    for (float i = 0.; i < 8.; i++) { // iteraciones variables segun zoom
        p = abs(p + .5) - abs(p - .5) - p; // boxfold
        p /= clamp(p.x * p.y, .25, 1.); // cousinfold
        p *= .5; // escala
        p -= 1.; // translación
        float v = abs(p.x) + fract(p.y * .2 + time * .5 + i * .15) * .5; // para capturar el valor más cercano al eje x
                            // y animar sumando fract de p.y y time, ademas de la iteracion actual para desfasar 
        if (v < ot) // no uso min ya que quiero capturar la iteracion tambien, si el valor v es menor...
        {
            ot = v; // guardo el valor menor en ot
            it = i; // guardo la iteracion 
        }
        
    }
    ot = exp(-10. * ot); // exp negativo invierte ot y le da contraste (comprime)
    return hsv2rgb(vec3(it*.1,.7,2.)) * ot + length(p) *.005 ; // creo rgb con hsv usando de hue iteracion guardada 
                        //luego multiplicado por orbit trap y sumando length de las coordenadas finales (blanco)
}


void main(void)
{
    vec2 uv = gl_FragCoord.xy / resolution - .5;
    uv.x *= resolution.x / resolution.y;
   // uv.x *= 1.+uv.y; // deformacion de uv.x para simular perspectiva
    vec3 col = fractal(uv);
    fragColor = vec4(col,1.);
}


#version 150

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;
uniform sampler2D texture3;
uniform sampler2D prevFrame;
uniform sampler2D prevPass;

in VertexData
{
    vec4 v_position;
    vec3 v_normal;
    vec2 v_texcoord;
} inData;

out vec4 fragColor;

// RAYMARCHING BASICO DE UNA ESFERA

// nomenclaturas generales:
// p = posición en el espacio
// d = distancia
// dir = dirección

// VARIABLES GLOBALES

// distancia mínima en la que se considera que se chocó con un objeto
// también funciona como el nivel de detalle de una superficie

float det = .001;

// distancia máxima que recorrerá el rayo, lo que esté más allá de
// esta distancia se considera fuera de la escena

float maxdist = 30.;

// máxima cantidad de pasos que dará el raymarching
// un valor estandar puede ser 100
// pero puede que necesitemos más según la escena

int maxsteps = 100;

// FUNCIONES DE DISTANCIA PRIMITIVAS 
// son las que nos devuelven la distancia estimada para diferentes formas geométricas
// en este caso usaremos una de las más simples, una esfera, que es simplemente un length
// de la posición, restándole el radio de la misma

float sphere(vec3 p, float rad) 
{
    return length(p) - rad;
}

// FUNCION DE ESTIMACION DE DISTANCIA
// se va a encargar de devolvernos la distancia estimada a uno o varios objetos
// se pueden hacer aquí varias alteraciones a las formas primitivas
// algo que se verá en los próximos ejemplos

float de(vec3 p) 
{
    float d = sphere(p, 3.);
    return d;
}

// FUNCION NORMAL
// La normal es el vector que es perpendicular a la superficie para un punto determinado
// nos sirve principalmente para calcular la iluminación en dicho punto
// la fórmula utiliza para este cálculo la diferencia entre la distancia obtenida 
// para 3 puntos apenas desplazados en los ejes x, y, z, 
// con la distancia obtenida en el punto actual.
// (esta explicación es sólo para saber lo que hace, en la práctica la podemos copiar y pegar o
// memorizarla, ya que no hay mucho para experimentar acá)

vec3 normal(vec3 p) 
{   
    vec2 d = vec2(0., det); // det es la distancia que establecimos como el nivel de detalle
    
    // usamos aquí la variable d para establecer un corrimiento de la posición original en x, y, z
    // según si ponemos x o y (de la variable d) en cada posición luego del punto, 
    // estamos estableciendo en que eje va el desplazamiento, que es igual a det
    
    return normalize(vec3(de(p + d.yxx), de(p + d.xyx), de(p + d.xxy)) - de(p));
    
    // también podríamos colocar de(p + vec3(det, 0., 0.)) etc, esto es sólo para hacerlo más fácil
}

// FUNCION SHADE
// Es la que va a establecer el color final según la iluminación, el color de la superficie, etc.

vec3 shade(vec3 p, vec3 dir) {
    
    // establecemos la dirección desde donde viene la luz
    // en este caso es una sola fuente, y no es una luz ubicada en el espacio,
    // sino sólo una dirección desde donde viene, como si fuera una fuente de luz lejana
    // por ejemplo el sol
    
    // x = derecha/izquierda - y = arriba/abajo - z = delante/detrás
    vec3 lightdir = normalize(vec3(1.5, 1., -1.)); 
    
    // como sólo hay un objeto en la escena, definimos su color aquí
    
    vec3 col = vec3(0., .0 , 1.);
    
    // obtenemos la normal
    
    vec3 n = normal(p);
    
    // calculamos la luz difusa, que es la que se dispersa luego de rebotar en la superficie
    // para esto usamos la función dot (producto escalar), que en este caso la podemos ver
    // como una función que dados dos vectores normalizados (de largo 1.), nos devuelve un valor
    // entre -1. y 1. según cuán alineados están dichos vectores.
    // de esta manera obtenemos el sombreado de la superficie según hacia qué dirección apunta 
    // la misma y la diferencia con la dirección desde donde viene la luz. 
    // usamos la función max porque queremos descartar los valores negativos,
    // si no está apuntando a la luz, que sea 0.
    
    float diff = max(0., dot(lightdir, n));
    
    // calculamos la luz especular, que es la que se refleja directamente como si fuera un espejo,
    // y nos dá lo que podríamos llamar como el "brillo" en la superficie.
    
    // primero obtenemos, con la función reflect que ya trae GLSL, el vector reflejo entre
    // la dirección en la que va el rayo y la superficie
    
    vec3 refl = reflect(dir, n);
    
    // caculamos la luz especular, usando también la función dot obtenemos 
    // la diferencia entre este vector y la dirección desde que viene la luz, 
    // elevada a una potencia con la función pow, que nos va a determinar el tamaño del "brillo"
    
    float spec = pow(max(0., dot(lightdir, refl)), 20.);
    
    // la luz ambiental es la que va a iluminar uniformemente toda la superficie
    float amb = .1;

    // este es una de las formas de calcular la combinación de las luces
    // considerando una luz blanca que golpea un objeto uniformemente azul
    // y es el color multiplicado por la suma de la luz ambiental y la difusa,
    // sumandole a ese resultado la luz especular (brillo)
    
    // podemos alterar los valores de estas variables para modificar la iluminación
    // en este caso le bajé un poco el brillo a la especular
    
    return col*(amb + diff) + spec * .7;
    
}



// FUNCION DE RAYMARCHING

vec3 march(vec3 from, vec3 dir) 
{
    // variables que vamos a usar
    // d = distancia actual al objeto más próximo
    // td = distancia total recorrida desde la cámara
    // p = posición actual del rayo
    // col = color final

    float d, td=0.;
    vec3 p, col;

    // bucle del raymarching
    // a cada paso avanzará según la distancia obtenida 
    // en la posición actual, que nos dará la función de distancia de()

    for (int i=0; i<maxsteps; i++) 
    {
        // obtenemos la posición actual de rayo para esta iteración
        // distancia de la cámara + total distancia recorrida * dirección hacia la que va el rayo
        // en el primer paso td = 0 por lo que el rayo está en la posición de la cámara

        p = from + td * dir;

        // llamamos a la función de estimación de distancia, que devolverá
        // la distancia desde este punto al objeto más cercano

        d = de(p);

        // si la distancia es menor al umbral que definimos para determinar si se chocó con un objeto,
        // o bien el rayo sobrepasó la distancia máxima que especificamos, cortamos el for

        if (d < det || td > maxdist) break;

        // sumamos la nueva distancia obtenida en el acumulador, el rayo avanza

        td += d;
    }

    // Una vez que el for termina, se decide qué hacer según si el rayo golpeó una superficie o no

    if (d < det) // el rayo chocó con una superficie
    {
        // retrocedemos el rayo un paso atrás con distancia igual a det
        // esto es para asegurarnos que estamos "fuera" de la distancia establecida
        // por det como la mínima para determinar que se chocó con un objeto
        // y mejora el cálculo de la normal, evitando banding y artefactos
        
        p -= dir * det; 
        
        // llamamos a la función shade, que se encargará de sombrear la superficie
        // para este punto según la iluminación que reciba

        col = shade(p, dir);
    }
    else // el rayo no chocó con una superficie
    {
        // aquí podemos dibujar un fondo por ejemplo

        col = mod(gl_FragCoord.y,10.)*vec3(.04,0.,0.);
    }
    return col;    
}

// MAIN

void main(void)
{
    // construimos las uv y centramos, los valores estarán entre -.5 y .5
    // también se puede multiplicar luego por 2 para tener entre -1. y 1.
 
    vec2 uv = gl_FragCoord.xy/resolution.xy - .5; 
    
    // corrección de aspect ratio
    
    uv.x *= resolution.x / resolution.y; 
    
    // posición de la cámara en la escena
    
    vec3 from = vec3(0., 0., -10.);
    
    // dirección del rayo para este pixel
    // el valor 1. se puede cambiar para 
    // especificar el campo de visión (FOV - field of view)
    // todas los vec3 que representen una dirección deben estar normalizados
    // es decir que el largo total del vector sea 1.
 
    vec3 dir = normalize(vec3(uv, 1.));

    // llamamos a la función de raymarching que nos devolverá el color del pixel

    vec3 col = march(from, dir);

    fragColor = vec4(col, 1.);
}

#version 150

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;
uniform sampler2D texture3;
uniform sampler2D prevFrame;
uniform sampler2D prevPass;

in VertexData
{
    vec4 v_position;
    vec3 v_normal;
    vec2 v_texcoord;
} inData;

out vec4 fragColor;

// ESFERA Y CUBO DE DIFERENTES COLORES

// Agrego comentarios a lo que cambia con respecto
// al ejemplo anterior de una esfera y un solo color


// VARIABLES GLOBALES

float det = .001;
float maxdist = 30.;
int maxsteps = 100;
// variable donde se establecerá el color de cada objeto
vec3 objcol;

// FUNCION DE ROTACION

mat2 rot(float a) {
    float s=sin(a), c=cos(a);
    return mat2(c,s,-s,c);
}


// FUNCIONES DE DISTANCIA PRIMITIVAS 

float sphere(vec3 p, float rad) 
{
    return length(p) - rad;
}

// función de distancia a una "caja", en el vec3 c van las dimensiones
// alto, ancho, largo
float box(vec3 p, vec3 c)
{
    p=abs(p)-c;
    return length(max(vec3(0.), p) + min(0, max(p.z, max(p.x, p.y))));
}


// FUNCION DE ESTIMACION DE DISTANCIA

float de(vec3 p) 
{
    p.xz *= rot(time);
    // desplazamos x para ubicar la esfera en -3.
    p.x -= 3.;

    // guardamos la distancia a la esfera en sph
    float sph = sphere(p, 2.);

    // desplazamos x para la posicion del cubo en +3.
    p.x += 6.;

    // guardamos la distancia al cubo en box
    float box = box(p, vec3(2.));
    
    // la función min sirve en este caso para combinar objetos en la escena
    // aquí la usamos con sph y box para que aparezcan ambos y almacenamos
    // el resultado en d que va a ser la distancia que devolverá la función
    float d = min(sph, box);

    // para darle a la esfera y el cubo diferentes colores, simplemente
    // tenemos que comparar d con sph y box
    // si d == sph, estamos más cerca de la esfera 
    // si d == box, estamos más cercanos al cubo
    // en base a eso elegimos el color de cada objeto y lo almacenamos en objcol

    if (d == sph) objcol = vec3(0., 0., 1.);
    if (d == box) objcol = vec3(1., 1., 0.);

    return d;
}

// FUNCION NORMAL

vec3 normal(vec3 p) 
{   
    vec2 d = vec2(0., det);
    
    return normalize(vec3(de(p + d.yxx), de(p + d.xyx), de(p + d.xxy)) - de(p));
}

// FUNCION SHADE

vec3 shade(vec3 p, vec3 dir) {
    
    vec3 lightdir = normalize(vec3(1.5, 1., -1.)); 
    
    // aquí definimos el color del objeto según la variable objcolor seteada en la funcion
    // de distancia. La guardamos en col antes de llamar a la funcion normal
    vec3 col = objcol;
    
    
    vec3 n = normal(p);
    
    float diff = max(0., dot(lightdir, n));
    
    vec3 refl = reflect(dir, n);
    
    float spec = pow(max(0., dot(lightdir, refl)), 20.);
    
    float amb = .1;
    
    return col*(amb + diff) + spec * .7;
    
}



// FUNCION DE RAYMARCHING

vec3 march(vec3 from, vec3 dir) 
{

    float d, td=0.;
    vec3 p, col;


    for (int i=0; i<maxsteps; i++) 
    {
        p = from + td * dir;

        d = de(p);

        if (d < det || td > maxdist) break;

        td += d;
    }

    if (d < det)
    {
        p -= det * dir;
        col = shade(p, dir);
    }
    else 
    {
        // para este background estoy ubicando la posición en el fondo de la escena
        // from + distancia máxima * dirección del rayo
        p = from + maxdist * dir;
        // usamos esta posición para dibujar un fondo
        // en este caso es un fondo simple usando la función sin
        col += sin(p*2.)*0.0;
    }
    return col;    
}

// MAIN

void main(void)
{
 
    vec2 uv = gl_FragCoord.xy/resolution.xy - .5; 

    uv.x *= resolution.x / resolution.y; 
    
    vec3 from = vec3(0., 0., -15.);
 
    vec3 dir = normalize(vec3(uv, 1.));

    vec3 col = march(from, dir);

    fragColor = vec4(col, 1.);
}


#version 150

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;
uniform sampler2D texture3;
uniform sampler2D prevFrame;
uniform sampler2D prevPass;

in VertexData
{
    vec4 v_position;
    vec3 v_normal;
    vec2 v_texcoord;
} inData;

out vec4 fragColor;

// INTERSECCIÓN DE OBJETOS Y DUPLICACION UTILIZANDO ABS()

// Agrego comentarios a lo que cambia con respecto
// al ejemplo anterior 


// VARIABLES GLOBALES

float det = .001;
float maxdist = 30.;
int maxsteps = 100;
vec3 objcol;

// FUNCION DE ROTACION

mat2 rot(float a) {
    float s=sin(a), c=cos(a);
    return mat2(c,s,-s,c);
}


// FUNCIONES DE DISTANCIA PRIMITIVAS 

float sphere(vec3 p, float rad) 
{
    return length(p) - rad;
}

// función de distancia a una "caja", en el vec3 c van las dimensiones
// alto, ancho, largo
float box(vec3 p, vec3 c)
{
    p=abs(p)-c;
    return length(max(p,0.))+min(0.,max(p.z,max(p.x,p.y)));
}

// construccion de un objeto usando las primitivas combinadas con max
// para obtener su interseccion. Esto generará una forma que es igual
// al espacio donde formas combinadas se intersecten.
// en este caso intersectamos un cubo con una esfera

float obj(vec3 p) 
{
    float box = box(p, vec3(1.));
    float sph = sphere(p, 1.3);
    float d = max(sph, box);
    return d;
}


// FUNCION DE ESTIMACION DE DISTANCIA

float de(vec3 p) 
{
    // rotamos en dos ejes
    p.xz *= rot(time);
    p.yz *= rot(time);

    // guardamos la distancia a la esfera en sph
    float sph = sphere(p, 3.);

    // hacemos que p sea igual al valor absoluto de p (los negativos pasan a ser positivos)
    p=abs(p);

    // desplazamos posicion del objeto en los ejes en que la queremos replicar
    // (en este caso todos), y siempre restando
    p -= 4.;

    // guardamos la distancia al objeto que creamos en obj
    float obj = obj(p);
    
    float d = min(sph, obj);

    if (d == sph) objcol = vec3(0., 0., 1.);
    if (d == obj) objcol = vec3(1., 1., 0.);

    return d;
}

// FUNCION NORMAL

vec3 normal(vec3 p) 
{   
    vec2 d = vec2(0., det);
    
    return normalize(vec3(de(p + d.yxx), de(p + d.xyx), de(p + d.xxy)) - de(p));
}

// FUNCION SHADE

vec3 shade(vec3 p, vec3 dir) {
    
    vec3 lightdir = normalize(vec3(1.5, 1., -1.)); 
    
    // aquí definimos el color del objeto según la variable objcolor seteada en la funcion
    // de distancia. La guardamos en col antes de llamar a la funcion normal
    vec3 col = objcol;
    
    
    vec3 n = normal(p);
    
    float diff = max(0., dot(lightdir, n));
    
    vec3 refl = reflect(dir, n);
    
    float spec = pow(max(0., dot(lightdir, refl)), 20.);
    
    float amb = .1;
    
    return col*(amb + diff) + spec * .7;
    
}



// FUNCION DE RAYMARCHING

vec3 march(vec3 from, vec3 dir) 
{

    float d, td=0.;
    vec3 p, col;


    for (int i=0; i<maxsteps; i++) 
    {
        p = from + td * dir;

        d = de(p);

        if (d < det || td > maxdist) break;

        td += d;
    }

    if (d < det)
    {
        p -= det * dir;
        col = shade(p, dir);
    }
    else 
    {
        // para este background estoy ubicando la posición en el fondo de la escena
        // from + distancia máxima * dirección del rayo
        p = from + maxdist * dir;
        // usamos esta posición para dibujar un fondo
        // en este caso es un fondo simple usando la función sin
        col += sin(p*2.)*.2;
    }
    return col;    
}

// MAIN

void main(void)
{
 
    vec2 uv = gl_FragCoord.xy/resolution.xy - .5; 

    uv.x *= resolution.x / resolution.y; 
    
    vec3 from = vec3(0., 0., -15.);
 
    vec3 dir = normalize(vec3(uv, 1.));

    vec3 col = march(from, dir);

    fragColor = vec4(col, 1.);
}


#version 150

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;
uniform sampler2D texture3;
uniform sampler2D prevFrame;
uniform sampler2D prevPass;

in VertexData
{
    vec4 v_position;
    vec3 v_normal;
    vec2 v_texcoord;
} inData;

out vec4 fragColor;

// RESTAR UN OBJETO A OTRO

// Igual al ejemplo anterior, pero reemplazamos la esfera central
// por otro objeto que resulta de restarle a un cubo la esfera


// VARIABLES GLOBALES

float det = .001;
float maxdist = 30.;
int maxsteps = 100;
vec3 objcol;

// FUNCION DE ROTACION

mat2 rot(float a) {
    float s=sin(a), c=cos(a);
    return mat2(c,s,-s,c);
}


// FUNCIONES DE DISTANCIA PRIMITIVAS 

float sphere(vec3 p, float rad) 
{
    return length(p) - rad;
}

float box(vec3 p, vec3 c)
{
    p=abs(p)-c;
    return length(max(p,0.))+min(0.,max(p.z,max(p.x,p.y)));
}

// construccion de un objeto usando las primitivas combinadas con max
// para obtener su interseccion. Esto generará una forma que es igual
// al espacio donde formas combinadas se intersecten.
// en este caso intersectamos un cubo con una esfera

float obj1(vec3 p) 
{
    float box = box(p, vec3(1.));
    float sph = sphere(p, 1.3);
    float d = max(sph, box);
    return d;
}

float obj2(vec3 p) 
{
    float box = box(p, vec3(2.));
    float sph = sphere(p, 2.5);
    // de esta manera le restamos al cubo la forma de la esfera
    float d = max(-sph, box);
    return d;
}


// FUNCION DE ESTIMACION DE DISTANCIA

float de(vec3 p) 
{
    // rotamos en dos ejes
    p.xz *= rot(time);
    p.yz *= rot(time);

    // guardamos la distancia al objeto 1
    float obj2 = obj2(p);

    // antes de sacar el abs, agrego una rotacion adicional a las coordenadas
    // los objetos amarillos van a rotar alrededor del objeto azul
    p.xy *= rot(time*2.);
    p=abs(p);

    // desplazamos posicion del objeto en los ejes en que la queremos replicar
    // (en este caso todos), y siempre restando
    p -= 3.;


    // guardamos la distancia al objeto2 
    float obj1 = obj1(p);
    
    
    // obtenemos la distancia minima entre obj1 y obj2 para combinarlas en la escena
    float d = min(obj1, obj2);

    // coloreamos segun el objeto con el que choca el rayo
    if (d == obj2) objcol = vec3(0., 0., 1.);
    if (d == obj1) objcol = vec3(1., 1., 0.);

    return d;
}

// FUNCION NORMAL

vec3 normal(vec3 p) 
{   
    vec2 d = vec2(0., det);
    
    return normalize(vec3(de(p + d.yxx), de(p + d.xyx), de(p + d.xxy)) - de(p));
}

// FUNCION SHADE

vec3 shade(vec3 p, vec3 dir) {
    
    vec3 lightdir = normalize(vec3(1.5, 1., -1.)); 
    
    // aquí definimos el color del objeto según la variable objcolor seteada en la funcion
    // de distancia. La guardamos en col antes de llamar a la funcion normal
    vec3 col = objcol;
    
    
    vec3 n = normal(p);
    
    float diff = max(0., dot(lightdir, n));
    
    vec3 refl = reflect(dir, n);
    
    float spec = pow(max(0., dot(lightdir, refl)), 20.);
    
    float amb = .1;
    
    return col*(amb + diff) + spec * .7;
    
}



// FUNCION DE RAYMARCHING

vec3 march(vec3 from, vec3 dir) 
{

    float d, td=0.;
    vec3 p, col;


    for (int i=0; i<maxsteps; i++) 
    {
        p = from + td * dir;

        d = de(p);

        if (d < det || td > maxdist) break;

        td += d;
    }

    if (d < det)
    {
        p -= det * dir;
        col = shade(p, dir);
    }
    else 
    {
        // para este background estoy ubicando la posición en el fondo de la escena
        // from + distancia máxima * dirección del rayo
        p = from + maxdist * dir;
        // usamos esta posición para dibujar un fondo
        // en este caso es un fondo simple usando la función sin
        col += sin(p*2.)*.2;
    }
    return col;    
}

// MAIN

void main(void)
{
 
    vec2 uv = gl_FragCoord.xy/resolution.xy - .5; 

    uv.x *= resolution.x / resolution.y; 
    
    vec3 from = vec3(0., 0., -15.);
 
    vec3 dir = normalize(vec3(uv, 1.));

    vec3 col = march(from, dir);

    fragColor = vec4(col, 1.);
}


#version 150

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;

in VertexData
{
    vec4 v_position;
    vec3 v_normal;
    vec2 v_texcoord;
} inData;

out vec4 fragColor;

// DESPLAZAMIENTOS/DEFORMACIONES DE LA FUNCIÓN DE DISTANCIA
// Y COLOREADO VARIABLE DEL OBJETO


// VARIABLES GLOBALES

float det = .001;
float maxdist = 30.;

// tuve que subir los maxsteps para esta escena
// esto es algo que hay que ir probando a medida
// que vamos creando escenas mas complejas
// y por ejemplo si tenemos que hacer que 
// el resultado de la funcion de distancia
// sea mas chico como se ve más abajo
int maxsteps = 150;
vec3 objcol;

// FUNCION DE ROTACION

mat2 rot(float a) {
    float s=sin(a), c=cos(a);
    return mat2(c,s,-s,c);
}


// FUNCIONES DE DISTANCIA PRIMITIVAS 

float sphere(vec3 p, float rad) 
{
    return length(p) - rad;
}

// función de distancia a un "piso" en xz
// "y" es la altura en la que queremos que esté
float ground(vec3 p, float y) 
{
    p.y += y;
    return abs(p.y);
}


// FUNCION DE ESTIMACION DE DISTANCIA

float de(vec3 p) 
{

    // guardamos la posicion original
    vec3 pos = p;

    p.xz *= rot(time);
    p.yz *= rot(time);
    float sph = sphere(p, 2.);

    // piso - lo calculamos con las coordenadas guardadas 
    // antes de las rotaciones para que quede fijo
    // tambien podemos desplazar dichas coordenadas para obtener un relieve
    pos.y += cos(pos.x)*.3;    
    pos.y += sin(pos.z)*.3;    
    float pla = ground(pos, 2.);

    // podemos sumarle o restarle un valor a la distancia a un objeto
    // para lograr deformaciones del mismo.
    // para eso utilizamos una función que use las coordenadas x,y,z y devuelva un float
    // en este caso usaremos length y sin

    float l = length(sin(p*5.))*.2;

    sph -= l;

    // combinamos esfera con piso
    
    float d = min(sph, pla);

    // también podemos usar una función que altere el color del objeto
    // en este caso uso la misma que el desplazamiento para mezclar dos colores
    // con la función mix y smoothstep

    if (d == sph) objcol = mix(vec3(.5,0.,0), vec3(1.), smoothstep(.2,.3, l));
    if (d == pla) objcol = length(fract(pos.xz)) * vec3(0.,.7,.8);

    // según cuánto alteremos la función de distancia, vamos a tener que hacer
    // más pequeña la distancia final a fin de evitar artefactos extraños en el render
    // en este caso multiplico por .6
    // hay que tener en cuenta que hacer esto implica que el raymarching necesite 
    // más pasos y disminuye la performance
    return d * .7;
}

// FUNCION NORMAL

vec3 normal(vec3 p) 
{   
    vec2 d = vec2(0., det);
    
    return normalize(vec3(de(p + d.yxx), de(p + d.xyx), de(p + d.xxy)) - de(p));
}

// FUNCION SHADE

vec3 shade(vec3 p, vec3 dir) {
    
    vec3 lightdir = normalize(vec3(1.5, 1., -1.)); 
    
    // aquí definimos el color del objeto según la variable objcolor seteada en la funcion
    // de distancia. La guardamos en col antes de llamar a la funcion normal
    vec3 col = objcol;
    
    
    vec3 n = normal(p);
    
    float diff = max(0., dot(lightdir, n));
    
    vec3 refl = reflect(dir, n);
    
    float spec = pow(max(0., dot(lightdir, refl)), 20.);
    
    float amb = .1;
    
    return col*(amb + diff) + spec * .7;
    
}



// FUNCION DE RAYMARCHING

vec3 march(vec3 from, vec3 dir) 
{

    float d, td=0.;
    vec3 p, col;


    for (int i=0; i<maxsteps; i++) 
    {
        p = from + td * dir;

        d = de(p);

        if (d < det || td > maxdist) break;

        td += d;
    }

    if (d < det)
    {
        p -= det * dir;
        col = shade(p, dir);
    }
    else 
    {
        p = from + maxdist * dir;
        // otro ejemplo de fondo
        col += fract(length(p.xy*.5)) * vec3(.1,.3,.4);
    }
    return col;    
}

// MAIN

void main(void)
{
 
    vec2 uv = gl_FragCoord.xy/resolution.xy - .5; 

    uv.x *= resolution.x / resolution.y; 
    
    vec3 from = vec3(0., 0., -10.);
 
    vec3 dir = normalize(vec3(uv, 1.));

    vec3 col = march(from, dir);

    fragColor = vec4(col, 1.);
}

#version 150

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;
uniform sampler2D texture3;
uniform sampler2D prevFrame;
uniform sampler2D prevPass;

in VertexData
{
    vec4 v_position;
    vec3 v_normal;
    vec2 v_texcoord;
} inData;

out vec4 fragColor;

// SOMBRAS - NIEBLA - ROTACION DE CAMARA

// agregamos en el calculo de las luces una funcion que calcula la sombra
// segun la direccion de la fuente de luz

// veremos una forma de agregar un efecto de niebla

// y también veremos una forma simple de rotar la cámara
// y como pasar un id del objeto para colorearlo en la función shade()

// VARIABLES GLOBALES

float det = .001;
float maxdist = 30.;

int maxsteps = 150;

// en esta variable vamos a almacenar un id según el objeto en la escena
float objid;

// FUNCION DE ROTACION

mat2 rot(float a) {
    float s=sin(a), c=cos(a);
    return mat2(c,s,-s,c);
}


// FUNCIONES DE DISTANCIA PRIMITIVAS 

float sphere(vec3 p, float rad) 
{
    return length(p) - rad;
}

float box(vec3 p, vec3 c)
{
    p=abs(p)-c;
    return length(max(p,0.))+min(0.,max(p.z,max(p.x,p.y)));
}

float ground(vec3 p, float y) 
{
    p.y += y;
    return abs(p.y);
}


// FUNCION DE ESTIMACION DE DISTANCIA

float de(vec3 p) 
{
    vec3 pos = p;

    float box = box(p, vec3(1.,2.,1.));

    float pla = ground(pos, 2.);
    
    float d = min(box, pla);

    // en lugar de establecer el color de los objetos aquí, vamos a pasar un id
    // que va a tomar la función shade para calcular el color allí
    // esta es una forma de obtener un id que sería 1 para la esfera, 2 para el piso
        
    objid = step(box, d) + step(pla, d) * 2.;

    return d;
}

// FUNCION NORMAL

vec3 normal(vec3 p) 
{   
    vec2 d = vec2(0., det);
    
    return normalize(vec3(de(p + d.yxx), de(p + d.xyx), de(p + d.xxy)) - de(p));
}

// FUNCION SHADOW
// calcula la sombra, generando un efecto de suavizado de los bordes
// a medida que se aleja del objeto

float shadow(vec3 p, vec3 ldir) {
    float td=.001,sh=1.,d=det;
    for (int i=0; i<100; i++) {
        p+=ldir*d;
        d=de(p);
        td+=d;
        sh=min(sh,10.*d/td);
        if (sh<.001) break;
    }
    return clamp(sh,0.,1.);
}


// FUNCION SHADE

vec3 shade(vec3 p, vec3 dir) {

    // aquí definimos el color del objeto según la variable objcolor seteada en la funcion
    // de distancia. La guardamos en col antes de llamar a la funcion normal

    vec3 col;
    if (objid==1.) col=vec3(.5,.0,.1);
    if (objid==2.) col=vec3(0.,.5,.6);
    
    vec3 lightdir = normalize(vec3(1.5, 2., -1.)); 

    vec3 n = normal(p);

    // llamamos a la función sombra que nos dará un valor entre 0 y 1
    // segun el nivel de oclusión de la luminosidad
    // luego multiplicamos la luz difusa y la especular por este valor
    float sh = shadow(p, lightdir);    
    
    float diff = max(0., dot(lightdir, n)) * sh; // multiplicamos por sombra;
    
    vec3 refl = reflect(dir, n);
    
    float spec = pow(max(0., dot(lightdir, refl)), 20.) * sh; // multiplicamos por sombra;
    
    float amb = .1;
    
    return col*(amb + diff) + spec * .7;
    
}



// FUNCION DE RAYMARCHING

vec3 march(vec3 from, vec3 dir) 
{

    float d, td=0.;
    vec3 p, col;


    for (int i=0; i<maxsteps; i++) 
    {
        p = from + td * dir;

        d = de(p);

        if (d < det || td > maxdist) break;

        td += d;
    }

    if (d < det)
    {
        p -= det * dir;
        col = shade(p, dir);
    } else {
        // si no golpeo con ningun objeto, llevamos la distancia a la máxima
        // que se definió, o sea al fondo de la escena
        // esto sirve para el correcto cálculo de la niebla
        td = maxdist;
    }
    // efecto niebla
    // mix entre el color obtenido y 
    col = mix(vec3(.7),col, exp(-.004*td*td));
    return col;    
}

// MAIN

void main(void)
{
 
    vec2 uv = gl_FragCoord.xy/resolution.xy - .5; 

    uv.x *= resolution.x / resolution.y; 
    
    // oscilamos la posicion de la cámara en z
    vec3 from = vec3(0., 0., -10. + sin(time * .5) * 5.);
 
    vec3 dir = normalize(vec3(uv, 1.));

    //una forma simple de rotar la cámara
    //es rotando en los mismos ejes tanto from como dir
    from.xz *= rot(time*.3);
    dir.xz *= rot(time*.3);

    vec3 col = march(from, dir);

    fragColor = vec4(col, 1.);
}


#version 150

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;
uniform sampler2D texture3;
uniform sampler2D prevFrame;
uniform sampler2D prevPass;

in VertexData
{
    vec4 v_position;
    vec3 v_normal;
    vec2 v_texcoord;
} inData;

out vec4 fragColor;

// COPIAR OBJETOS A LO LARGO DE VARIOS EJES

// utilizando la función mod, podemos repetir objetos en la escena

// VARIABLES GLOBALES

float det = .001;
float maxdist = 50.;

int maxsteps = 150;

vec3 objcol;

// FUNCION DE ROTACION

mat2 rot(float a) {
    float s=sin(a), c=cos(a);
    return mat2(c,s,-s,c);
}


// FUNCIONES DE DISTANCIA PRIMITIVAS 

float sphere(vec3 p, float rad) 
{
    return length(p) - rad;
}

float box(vec3 p, vec3 c)
{
    p=abs(p)-c;
    return length(max(p,0.))+min(0.,max(p.z,max(p.x,p.y)));
}

float ground(vec3 p, float y) 
{
    p.y += y;
    return abs(p.y);
}


// FUNCION DE ESTIMACION DE DISTANCIA

float de(vec3 p) 
{

    vec3 pos = p;
    
    // utilizando la función mod podemos "tilear" objetos
    // a lo largo de uno o varios ejes
    // en el mod, el 4 indica la distancia entre objetos
    // y siempre debemos restar esa distancia / 2.
    p.xz = mod(p.xz, 8.) - 4.;

    float box = box(p, vec3(.3,2.,.3));

    float pla = ground(pos, 2.);
    
    float d = min(box, pla);

    // para generar el cuadriculado   
    p = abs(p * 3.);
    float c = pow(max(max(fract(p.x),fract(p.y)), fract(p.z)),10.);
    float b = pow(max(fract(p.x),fract(p.z)),10.);

    if (d==box) objcol=vec3(.5,.0,.1)+c;
    if (d==pla) objcol=vec3(0.,.5,.6)+b;

    return d;
}

// FUNCION NORMAL

vec3 normal(vec3 p) 
{   
    vec2 d = vec2(0., det);
    
    return normalize(vec3(de(p + d.yxx), de(p + d.xyx), de(p + d.xxy)) - de(p));
}

// FUNCION SHADOW
// calcula la sombra, generando un efecto de suavizado de los bordes
// a medida que se aleja del objeto

float shadow(vec3 p, vec3 ldir) {
    float td=.001,sh=1.,d=det;
    for (int i=0; i<100; i++) {
        p+=ldir*d;
        d=de(p);
        td+=d;
        sh=min(sh,10.*d/td);
        if (sh<.001) break;
    }
    return clamp(sh,0.,1.);
}


// FUNCION SHADE

vec3 shade(vec3 p, vec3 dir) {

    vec3 col = objcol;
    
    vec3 lightdir = normalize(vec3(1.5, 2., -1.)); 

    vec3 n = normal(p);

    float sh = shadow(p, lightdir);    
    
    float diff = max(0., dot(lightdir, n)) * sh; // multiplicamos por sombra;
    
    vec3 refl = reflect(dir, n);
    
    float spec = pow(max(0., dot(lightdir, refl)), 20.) * sh; // multiplicamos por sombra;
    
    float amb = .1;
    
    return col*(amb + diff) + spec * .7;
    
}



// FUNCION DE RAYMARCHING

vec3 march(vec3 from, vec3 dir) 
{

    float d, td=0.;
    vec3 p, col;


    for (int i=0; i<maxsteps; i++) 
    {
        p = from + td * dir;

        d = de(p);

        if (d < det || td > maxdist) break;

        td += d;
    }

    if (d < det)
    {
        p -= det * dir;
        col = shade(p, dir);
    } else {
        // si no golpeo con ningun objeto, llevamos la distancia a la máxima
        // que se definió, o sea al fondo de la escena
        // esto sirve para el correcto cálculo de la niebla
        td = maxdist;
    }
    // efecto niebla
    // mix entre el color obtenido y un color de la niebla
    // utilizando para mezclarlos la funcion exp con la variable td
    // que es la distancia en la que quedo el rayo con respecto a la cam
    // el -.01 en la funcion exp altera la distancia de la niebla
    col = mix(vec3(.7),col, exp(-.002*td*td));
    return col;    
}

// MAIN

void main(void)
{
 
    vec2 uv = gl_FragCoord.xy/resolution.xy - .5; 

    uv.x *= resolution.x / resolution.y; 
    
    vec3 from = vec3(0., 0.,-2.);
 
    vec3 dir = normalize(vec3(uv, 1.));

    //una forma simple de rotar la cámara
    //es rotando en los mismos ejes tanto from como dir
    from.xz *= rot(time*.3);
    dir.xz *= rot(time*.3);

    vec3 col = march(from, dir);

    fragColor = vec4(col, 1.);
}


#version 150

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;
uniform sampler2D texture3;
uniform sampler2D prevFrame;
uniform sampler2D prevPass;

in VertexData
{
    vec4 v_position;
    vec3 v_normal;
    vec2 v_texcoord;
} inData;

out vec4 fragColor;

float maxdist=50.;
float det=.001;
vec3 objcol;

mat2 rot(float a) {
    float s=sin(a), c=cos(a);
    return mat2(c,s,-s,c);
}

// funcion smooth min, funciona como min para combinar pero "suaviza" y funde los contornos
// k es el factor que controla este efecto
float smin( float a, float b, float k )
{
    float h = clamp( 0.5+0.5*(b-a)/k, 0.0, 1.0 );
    return mix( b, a, h ) - k*h*(1.0-h);
}

float box(vec3 p, vec3 c)
{
    vec3 z=abs(p)-c;
    return length(max(vec3(0.),z))+min(0.,max(max(z.z,z.x),z.y));
}


float de(vec3 p) {
    p.xz*=rot(time*.5);
    p.yz*=rot(time*.5);
    float sph1 = length(p+vec3(sin(time*.5)*10.,0.,0.))-2.;
    float sph2 = length(p-vec3(0.,0.,cos(time*.5)*10.))-2.;
    float sph3 = length(p-vec3(0.,sin(time*.5)*8.,cos(time*.25)*8.))-2.;
    vec3 p2=p;
    p2.yz*=rot(time*.1);
    p2.xy*=rot(time*.1);
    float box1 = box(p2, vec3(3.));
    float d = min(min(sph1, sph2),sph3);
    d=smin(d,box1,.5);
    if (abs(d-sph1)<1.) objcol=vec3(1.,0.,0.);
    if (abs(d-sph2)<1.) objcol=vec3(0.,1.,0.);
    if (abs(d-sph3)<1.) objcol=vec3(0.,0.,1.);
    if (abs(d-box1)<1.) objcol=.4+pow(length(sin(p2*6.))*.7,20.)*vec3(.6,.4,.3);
    return d;
}

vec3 normal(vec3 p)
{
    vec2 d=vec2(0.,det);
    return normalize(vec3(de(p+d.yxx),de(p+d.xyx),de(p+d.xxy))-de(p));
}

vec3 shade(vec3 p, vec3 dir) {
    vec3 n=normal(p);
    vec3 lightdir = normalize(vec3(3.,1.,-1.));
    float amb = .1;
    float dif=max(0.,dot(lightdir, n))*.7;
    vec3 ref = reflect(lightdir, n);
    float spe = pow(max(0.,dot(dir,ref)),30.)*.7;
    return objcol*(amb+dif)+spe;
}


vec3 march(vec3 from, vec3 dir)
{
    vec3 p, col=vec3(0.);
    float totdist=0., d;
    for (int i=0; i<100; i++) 
    {
        p=from+dir*totdist;
        d=de(p);
        if (d<det || totdist>maxdist) break;
        totdist+=d;
    }
    if (d<det) {
        p-=det*dir;
        col=shade(p,dir);
    } 
    return col;
}



void main(void)
{
    vec2 uv = -1. + 2. * inData.v_texcoord;
    uv.x*=resolution.x/resolution.y;
    vec3 dir = normalize(vec3(uv,3.));
    vec3 from = vec3(0.,0.,-30.);
    vec3 c=march(from,dir);
    fragColor = vec4(c,1.);
}

#version 150

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;

uniform sampler2D prevFrame;
uniform sampler2D prevPass;

in VertexData
{
    vec4 v_position;
    vec3 v_normal;
    vec2 v_texcoord;
} inData;

out vec4 fragColor;

float det = .001;
float maxdist = 60.;
int maxsteps = 100;
vec3 objcolor;
vec3 lightdir = normalize(vec3(1.,1.,-2.));


// funcion de rotacion
mat2 rot(float a) {
    float s=sin(a), c=cos(a);
    return mat2(c,s,-s,c);
}

// hash (random)
float hash(vec2 p)
{
    vec3 p3  = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// funcion noise
float noise( in vec2 p )
{
    vec2 i = floor( p );
    vec2 f = fract( p );
    
    vec2 u = f*f*(3.0-2.0*f);

    return mix( mix( hash( i + vec2(0.0,0.0) ), 
                     hash( i + vec2(1.0,0.0) ), u.x),
                mix( hash( i + vec2(0.0,1.0) ), 
                     hash( i + vec2(1.0,1.0) ), u.x), u.y);
}

// funcion de distancia a un ciclindro (h alto, r radio)
float sdCappedCylinder( vec3 p, float h, float r )
{
  vec2 d = abs(vec2(length(p.xz),p.y)) - vec2(h,r);
  return min(max(d.x,d.y),0.0) + length(max(d,0.0));
}

// funcion de distancia a una caja (c.xyz son las dimensiones)
float sdBox(vec3 p, vec3 c) {
    vec3 q = abs(p) - c;
    return length(max(vec3(0.), q));
}

// "tilear" el espacio radialmente (cant = cantidad de copias, offset = distancia desde el centro)
// recibe p y lo devuelve transformado. p debe ser un vec2, por ejemplo p.xz, p.xy
void radialCopy(inout vec2 p, float cant, float offset) 
{
    float d = 3.1416 / cant * 2.;
    float at = atan(p.y, p.x);
    float a = mod(at, d) - d *.5;
    p = vec2(cos(a), sin(a)) * length(p) - vec2(offset,0.);
}

// funcion de distancia a un engranaje
// min = combinar (sumar objetos)
// max(forma1, -forma2) resta la forma2 a la forma1
float engranaje(vec3 p)
{
    float d = sdCappedCylinder(p, 5, .4) - .1; // cilindro para la forma principal (rueda)
    d = max(d, -length(p.xz)+1.); // agujero central, length de p.xz equivale a cilindro de alto infinito, radio 1
    vec3 p2 = p; // guardo p en p2 auxiliar
    radialCopy(p2.xz, 5., 3.); // transformo xz para crear copias radiales (5 agujeros, 3 de distancia del centro)
    d = max(d, -length(p2.xz)+1.5); // con solo una funcion hago los 5 agujeros
    vec3 p3 = p; // guardo p en p3 auxiliar
    radialCopy(p3.xz, 15., 5.3); // copia radial para los dientes del engranaje (15 en total)
    d = min(d, sdBox(p3, vec3(.5, .3, .5))) - .1; // dientes del engranaje
    return d;
}

// funcion de distancia principal
float de(vec3 p) {
    float piso = p.y+7.; // distancia a un plano alineado en xz, movido +7 en y
    p.yz *= rot(-1.3); // inclinacion de los engranajes
    vec3 p1 = p; // guardo p en variable auxiliar 1
    p1.x-= 5.5; // muevo la coordenada x hacia la izquierda
    p1.xz *= rot(time); // aplico la rotacion del engranaje
    float engranaje1 = engranaje(p1); // distancia al engranaje 1
    vec3 p2 = p; // guardo p en variable auxiliar 2
    p2.x+=5.5; // muevo la coordenada x hacia la derecha
    p2.xz *= rot(-time); // aplico rotacion al engranaje 2
    float engranaje2 = engranaje(p2); // distancia al engranaje 2
    float d = min(engranaje1, engranaje2); // combino los dos engranajes
    d=min(d,piso); // agrego el piso
    //aplico color y noise
    if (d==engranaje1) objcolor = vec3(1.,1.,0.) - noise(p1.xz*30.) * .5; 
    if (d==engranaje2) objcolor = vec3(0.,1.,1.) - noise(p2.xz*30.) * .5;
    if (d==piso) objcolor = vec3(1.);
    return d;
}

// funcion calculo de normal
vec3 normal(vec3 p) {
    vec2 d = vec2(0.,det);
    return normalize(vec3(de(p+d.yxx),de(p+d.xyx),de(p+d.xxy))-de(p));
}

// funcion de proyección de sombras
// cuanto mas chico es el valor en la variable soft mas suave es la sombra
// devuelve un valor entre 0 y 1 para multiplicar luego por las luces
float shadow(vec3 p, vec3 ldir) {
    float soft = 20.;
    float td=0.,sh=1.,d=det;
    for (int i=0; i<50; i++) {
        p+=ldir*d;
        d=de(p);
        td+=d;
        sh=min(sh,soft*d/td);
        if (sh<.01) break;
    }
    return clamp(sh,0.,1.);
}

// funcion de shading
vec3 shade(vec3 p, vec3 dir) {
    vec3 col = objcolor; // guardo el color del objeto que golpeo el rayo
    vec3 n = normal(p); // calculo la normal (es conveniente guardar el color antes de llamar a esta funcion)
    float sh = shadow(p, lightdir); // calculo de sombra
    float amb = .1; // luz ambiental (pareja, no se aplica sombra)
    float dif = max(0.,dot(lightdir,n)) * .5 * sh; // luz difusa, multiplicada por la sombra
    vec3 ref = reflect(lightdir,n); // vector reflejo
    float spe = pow(max(0.,dot(ref,dir)),30.) * .7 * sh; // luz especular
    return col*(dif+amb)+spe; // calculo de color con luces resultantes
}

// funcion de raymarching
vec3 march(vec3 from, vec3 dir) {
    vec3 p, col=vec3(0.);
    float d, totdist=0.;
    for (int i=0; i<maxsteps; i++) {
        p = from + totdist * dir;
        d = de(p);
        totdist += d;
        if (totdist > maxdist || d < det) break;
    }
    if (d < det) { // golpeo un objeto
        p-= det*dir; // retrocedo un paso det
        col=shade(p, dir); // llamo a la funcion para shading
    } else { // no golpeo, es background
        p = 30. * dir; // ubico la posicion en un radio de 30 desde la direccion que viene el rayo
        col = pow(max(0.,dot(dir,lightdir)),100.) * vec3(1.5); // el dot entre lightdir y dir me sirve para dibujar la luz
        col += min(fract(p.x),fract(p.y))*.3*smoothstep(0.,20.,p.z); // fondo, de un lado es negro, del otro mosaico (segun p.z)
    }
    return col;
}

// funcion lookat
// sirve para alinear un vector con respecto a otro
// dir es la nueva direccion, up es el vector que se considera "arriba", normalmente vec3(0.,1.,0.) (coordenada y es arriba/abajo)
mat3 lookat(vec3 dir, vec3 up) {
    dir = normalize(dir); 
    vec3 rt = normalize(cross(dir, up));
    return mat3(rt, cross(rt, dir), dir);
}

void main(void)
{
    vec2 uv = gl_FragCoord.xy / resolution - .5;
    uv.x*=resolution.x/resolution.y;
    
    // posicion de la camara, aquí se mueve en una elipse que pasa por los agujeros centrales
    vec3 from = vec3(sin(time*.3) * 5., 0., cos(time*.3) *30.);
    // target es donde la camara va a apuntar, en este caso puse la posicion del agujero central del engranaje amarillo
    vec3 target = vec3(5.,0.,0.);
    // calculo del vector para alinear la camara
    vec3 camdir = normalize(target-from);
    // creamos dir normalmente
    vec3 dir = normalize(vec3(uv, 1.));
    // multiplicando por la matriz resultante de lookat, se alinea dir con la direccion de la camara
    dir = lookat(camdir, vec3(0.,1.,0.))* dir; // si cambianos el "up" por otro vector, se puede girar la camara sobre su eje
    vec3 col = march(from, dir);
    fragColor = vec4(col,1.);
}   

#version 150

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;


out vec4 fragColor;

// COPIAR OBJETOS A LO LARGO DE VARIOS EJES
// utilizando la función mod, podemos repetir objetos en la escena

// VARIABLES GLOBALES

float det = .001;
float maxdist = 50.;
int maxsteps = 200;

vec3 objcol;

// FUNCION DE ROTACION

mat2 rot(float a) {
    float s=sin(a), c=cos(a);
    return mat2(c,s,-s,c);
}

// FUNCIONES DE DISTANCIA PRIMITIVAS 

float sphere(vec3 p, float rad) 
{
    return length(p) - rad;
}

float box(vec3 p, vec3 c)
{
    p=abs(p)-c;
    return length(max(p,0.))+min(0.,max(p.z,max(p.x,p.y)));
}

float ground(vec3 p, float y) 
{
    p.y += y;
    return abs(p.y);
}


// FUNCION DE ESTIMACION DE DISTANCIA

float de(vec3 p) 
{
    vec3 pos = p; //guardo posicion inicial
    
    // utilizando la función mod podemos "tilear" objetos
    // a lo largo de uno o varios ejes
    // en el mod, el 3 indica la distancia entre objetos
    // y siempre debemos restar esa distancia / 2.
    // el id del tile se obtiene usando la funcion floor
    // de esos ejes, aquí xz, divido por el numero usado en el mod
    // con esto obtenemos un vec2 que indica en que tile está el rayo
    // un id por ejemplo sería vec2(1.,0.), que indica fila 1, columna 0
    vec2 id = floor(p.xz / 3.);
    p.xz = mod(p.xz, 3.) - 1.5;
    
    // se desplaza la coordenada y segun su id
    p.y += length(sin(id*10.)) * 2.5 - .5;
    
    float edificio = box(p, vec3(.7, 3., .5)); 

    // utilizo la posicion original para el suelo ya que p lo modifique
    float suelo = ground(pos, 2.);   
    
    float d = min(edificio, suelo);

    // ventanas y calles
    p = p * 3.;
    p.x = abs(p.x);
    float ventanas = min(fract(p.y*2.),fract(p.x*2)); 
    float calles = smoothstep(.65,.7,max(fract(p.x*.2),fract(p.z*.2)));

    if (d==edificio) objcol=vec3(.4,.4,.5) + ventanas; // sumo ventanas al color
    if (d==suelo) objcol=vec3(.5 - calles*.4); // resto calles al color para oscurecerlo

    return d * .7; // cuando usamos tiles que varían conviene achicar el paso para evitar artefactos.
                    // o sea que se "rompa" el raymarching en algunos lugares.
}

// FUNCION NORMAL

vec3 normal(vec3 p) 
{   
    vec2 d = vec2(0., det);
    return normalize(vec3(de(p + d.yxx), de(p + d.xyx), de(p + d.xxy)) - de(p));
}

// FUNCION SHADOW
// calcula la sombra, generando un efecto de suavizado de los bordes
// a medida que se aleja del objeto
// cuanto mas chico es soft, mas suave es la sombra

float shadow(vec3 p, vec3 ldir) {
    float td=.001,sh=1.,d=det;
    float soft=10.;
    for (int i=0; i<100; i++) {
        p+=ldir*d;
        d=de(p);
        td+=d;
        sh=min(sh,soft*d/td);
        if (sh<.001) break;
    }
    return clamp(sh,0.,1.);
}


// FUNCION SHADE

vec3 shade(vec3 p, vec3 dir) {
    vec3 col = objcol;
    vec3 lightdir = normalize(vec3(1.5, 2., -1.)); 
    vec3 n = normal(p);
    float sh = shadow(p, lightdir);    
    float diff = max(0., dot(lightdir, n)) * sh; // multiplicamos por sombra;
    vec3 refl = reflect(dir, n);
    float spec = pow(max(0., dot(lightdir, refl)), 20.) * sh; // multiplicamos por sombra;
    float amb = .1; // luz ambiental, la sombra no afecta
    
    return col*(amb + diff) + spec * .7;
    
}



// FUNCION DE RAYMARCHING

vec3 march(vec3 from, vec3 dir) 
{
    float d, td=0.;
    vec3 p, col;
    for (int i=0; i<maxsteps; i++) 
    {
        p = from + td * dir;
        d = de(p);
        if (d < det || td > maxdist) break;
        td += d;
    }

    if (d < det) // choco objeto, retroceder rayo y llamar a la func. shade
    {
        p -= det * dir;
        col = shade(p, dir);
    } else {
        // si no golpeo con ningun objeto, llevamos la distancia a la máxima
        // que se definió, o sea al fondo de la escena
        // esto sirve para el correcto cálculo de la niebla
        td = maxdist;
    }
    // efecto niebla
    // mix entre el color obtenido y un color de la niebla
    // utilizando para mezclarlos la funcion exp con la variable td
    // que es la distancia en la que quedo el rayo con respecto a la cam
    // el -.005 en la funcion exp es un valor que altera la distancia de la niebla
    col = mix(vec3(.65,.7,.8),col, exp(-.005*td*td));
    return col;    
}

// MAIN

void main(void)
{
 
    vec2 uv = gl_FragCoord.xy/resolution.xy - .5; 

    uv.x *= resolution.x / resolution.y; 
    vec3 from;
    vec3 dir = normalize(vec3(uv, .7));
    if (mod(time,10.)<5.) { // alterna entre las dos camaras cada 5 segundos
        // aquí el from va avanzando en z, moviendo la cámara
        from = vec3(0., 2.,time);
     
        // podemos girar la cámara simplemente
        // aplicando rotaciones 2D
        dir.xz *= rot(sin(time*.2));
        dir.yz *= rot(-.4);
    } else { // camara 2
        from = vec3(0., -1.,time);
    }
    vec3 col = march(from, dir);

    fragColor = vec4(col, 1.);
}

#version 150

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;

out vec4 fragColor;

// VARIABLES GLOBALES
float det = .001; // umbral para detectar choque 
vec3 lightpos1, lightpos2; // posicion de las luces
float light1, light2; // distancia a las luces
vec3 light1color = vec3(2.,1.,0.); // color luz 1
vec3 light2color = vec3(0.,1.,2.); // color luz 2

// matriz de rotación
mat2 rot(float a) 
{
    float s=sin(a), c=cos(a);
    return mat2(c,s,-s,c);
}

// distancia a un octaedro
float sdOctahedron( vec3 p, float s)
{
  p = abs(p);
  return (p.x+p.y+p.z-s)*0.57735027;
}

// función de distancia (distance estimation)
float de(vec3 p) 
{
    light1 = length(p - lightpos1) - .1; // distancia a las luces, que están definidas como esferas de radio .1
    light2 = length(p - lightpos2) - .1; // 
    p.yz *= rot(time * .7); // rotaciones
    p.xz *= rot(time * .5);
    float oct = max(sdOctahedron(p, 5.), -length(p)+3.3); // distancia a octaedro restando una esfera
    float d = min(oct, min(light1, light2)); // obtención de distancia mínima (combinar objetos)
    return d;
}


// función normal (vector perpendicular a la superficie)
vec3 normal(vec3 p) 
{
    vec2 d = vec2(0., det);
    return normalize(vec3(de(p+d.yxx), de(p+d.xyx), de(p+d.xxy)) - de(p));
}

// función shade (p = punto en el que golpeó el rayo, dir = dirección del rayo)
vec3 shade(vec3 p, vec3 dir)
{
    if (light1 < det) return light1color; // si golpeó a una luz, devolver el color de la misma
    if (light2 < det) return light2color; // sin aplicar obviamente el cálculo de su propia iluminación
    vec3 lightdir1 = normalize(lightpos1 - p); // obtención de la dirección hacia donde están las luces
    vec3 lightdir2 = normalize(lightpos2 - p); // desde el punto p
    float fade1 = exp(-.2 * distance(p, lightpos1)); // atenuación de la luz basada en la distancia entre p
    float fade2 = exp(-.2 * distance(p, lightpos2)); // y la posición de las mismas
    vec3 n = normal(p); // obtención de la normal
    float amb = .05; // luz ambiental
    vec3 dif1 = max(0., dot(lightdir1, n)) * light1color * fade1 * .7; // luces difusas, se aplica el color de la luz
    vec3 dif2 = max(0., dot(lightdir2, n)) * light2color * fade2 * .7; // y la atenuación según la distancia
    vec3 ref1 = reflect(lightdir1, n); // vector reflejo entre la dirección de la luz y
    vec3 ref2 = reflect(lightdir2, n); // el normal de la superficie
    vec3 spe1 = pow(max(0., dot(ref1, dir)),10.) * light1color * fade1; // calculo de luz especular, también 
    vec3 spe2 = pow(max(0., dot(ref2, dir)),10.) * light2color * fade2; // teniendo en cuenta la atenuación por distancia
    return amb + dif1 + spe1 + dif2 + spe2; // color final combinando las luces
}

// función de raymarching
vec3 march(vec3 from, vec3 dir) 
{
    float maxdist = 50.;
    float totdist = 0.;
    float steps = 100.;
    float d;
    vec3 p;
    vec3 col = vec3(0.);
    float glow1 = 0., glow2 = 0.; // variables para la obtención del brillo "glow" alrededor de las luces
    float glowgeneral = 0.; // variable para la obtención de glow general con "step count"
    for (float i=0.; i<steps; i++)
    {
        p = from + totdist * dir;
        d = de(p);
        if (d < det || totdist > maxdist) break;
        totdist += d;
        glow1 = max(glow1, 1. - light1); // capturamos cuando el rayo pasa cerca de las luces, obteniendo un valor
        glow2 = max(glow2, 1. - light2); // entre 0 y 1 según la distancia a la que pasó
        glowgeneral++; // step counting para obtener brillo glow general
    }
    if (d < det) 
    {
        col = shade(p, dir);
    }
    col += pow(glow1, 5.) * light1color; // sumamos el brillo glow de las luces, elevando a un exponente
    col += pow(glow2, 5.) * light2color; // para definir el tamaño del glow
    col += glowgeneral * glowgeneral * .0002; // lo mismo para el glow general que se puede apreciar en el objeto
                                             // este glow genera "banding", sobre todo si no está exponenciado
    return col;
}


void main(void)
{
    vec2 uv = (gl_FragCoord.xy - resolution / 2.) / resolution.y;
    vec3 from = vec3(0., 0., -25.);
    vec3 dir = normalize(vec3(uv, 1.5));
    lightpos1 = vec3(sin(time) * 8., sin(time * 2.), cos(time) * 8.); // definimos la posición de las luces
    lightpos2 = -lightpos1.yxz; // copia las coordenadas de la luz 1 rotando los ejes
    vec3 col = march(from, dir);
    fragColor = vec4(col, 1.);
}


#version 150

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;


out vec4 fragColor;

// VARIABLES GLOBALES
float det = .001; // umbral para detectar choque 
vec3 lightpos1, lightpos2; // posicion de las luces
float light1, light2; // distancia a las luces
vec3 light1color = vec3(2.,1.,0.); // color luz 1
vec3 light2color = vec3(0.,1.,2.); // color luz 2


// matriz de rotación
mat2 rot(float a) 
{
    float s = sin(a), c = cos(a);
    return mat2(c, s, -s, c);
}

// funcion smoothmin para combinar las ramas
float smin( float a, float b, float k )
{
    float h = clamp( 0.5+0.5*(b-a)/k, 0.0, 1.0 );
    return mix( b, a, h ) - k*h*(1.0-h);
}


// rama de radio r y largo l, desplazada para que se centre en el extremo inferior y curvada con sin
float rama(vec3 p, float r, float l) {
    p.x += sin(p.y)*.5;
    p.y += l;
    return max(abs(p.y)-l, length(p.xz) - r);
}


// fractal que genera el árbol
float fractal(vec3 p) 
{
    float x = p.x * .01; // guardo x para aplicar una diferencia en la rotación del loop, genera una asimetría
    p.xz *= rot(time*.2); // giro el árbol en xz
    float d = 1000.; // d va a ser la distancia final, se inicializa alto para que el primer smin sea igual a la distancia de la rama
    float rd = 1.; // "running derivative", se le debe aplicar el mismo escalado que la función de d0istancia, y luego divir por el mismo
                    // también sirve para escalar el tamaño de las ramas
    float sc = 1.2; // escala a aplicar para cada iteración
    // loop del fractal, cada iteración va a capturar la distancia más chica, lo que va a resultar en devolver
    // la distancia que corresponde a la rama por la que pasa el rayo, usando smoothmin para suavizar la combinación de las mismas
    for (int i=0; i<8; i++)
    {
        d = smin(d, (rama(p, .5 / rd, 4.)) / rd, .5); // captura la distancia menor
        // la función "rama" tiene como parámetros el radio que varía según la iteración para ir haciendo las ramas mas chicas
        p.xz = abs(p.xz); // "espejo" en xz
        p.xy *= rot(-.4 - x); // rotaciones, varía según la posición x guardada previamente 
        p.yz *= rot(.5);
        p *= sc; // escalado de las coordenadas
        rd *= sc; // escalado del running derivative
        p.y -= 10./ rd; // traslación de las coordenadas, escalado por el running derivative para que la distancia se vaya achicando
    }
    return d * .8 + .03; // devuelvo la distancia achicada un poco para evitar artefactos y sumandole un valor para hacer la figura más angosta
}

float de(vec3 p) 
{
    float fra = fractal(p); // distancia al árbol 
    float sue = p.y + 6.; // distancia al suelo
    light1 = length(p - lightpos1)-.5; // distancia a las luces según su posición 
    light2 = length(p - lightpos2)-1.; // (están definidas como esferas)
    float d = min(sue,min(fra, min(light1, light2))); // obtener distancia mínima
    return d;
}

// función de oclusión ambiental (ambient occlusion)
// se aplica luego a la luz ambiental para oscurecer las superficies que están ocluidas y simular
// que los rayos de luz indirecta llegan menos
float ao(vec3 p, vec3 n) {
    float scale=.2;
    float ao=0.;
    for(float i=0.; i<6.; i++ ) {
        float td=scale*i*i;
        float d=de(p+n*td);
        ao+=max(0.,(td-d)/td);
    }
    return clamp(1.-ao*.15,0.,1.);
}

// sombra de la luz 1, lanza un rayo desde la superficie de colisión hacia la luz
float shadow1(vec3 p) {
    vec3 lightdir = normalize(lightpos1 - p); // obtiene la dirección hacia la luz
    float td=.0,sh=1.,d=det;
    for (int i=0; i<80; i++) {
        p += lightdir * d; // posiciona el rayo
        d = de(p); // obtiene la distancia al objeto más cercano
        td += d; // avanza hacia la luz (td = total distance)
        sh = min(sh, 10. * d / td); // técnica para obtener sombras suavizadas 
        if (sh < .001 || light1<det) break; // si chocamos la luz o la sombra es casi 0, salir
    }
    if (light1<det) sh = 1.; // si chocamos la luz, no hay sombra
    return clamp(sh, 0., 1.); // hace que el valor de la sombra sea entre 0 y 1, para luego multiplicar por las luces
}

// sombra de la luz 2
float shadow2(vec3 p) {
    vec3 lightdir = normalize(lightpos2 - p);
    float td=.001,sh=1.,d=det;
    for (int i=0; i<80; i++) {
        p += lightdir * d;
        d = de(p);
        td += d;
        sh = min(sh, 10. * d / td);
        if (sh < .001 || light2<det) break;
    }
    if (light2<det) sh = 1.;
    return clamp(sh, 0., 1.);
}

// funció normal de la superficie
vec3 normal(vec3 p) 
{
    vec2 d = vec2(0., det);
    return normalize(vec3(de(p+d.yxx), de(p+d.xyx), de(p+d.xxy)) - de(p));
}

// shaderear
vec3 shade(vec3 p, vec3 dir)
{
    if (light1<det) return light1color; // se colisionó con una luz, devolver el color de la misma
    if (light2<det) return light2color;
    vec3 lightdir1 = normalize(lightpos1 - p); // obtener la dirección hacia cada una de las luces
    vec3 lightdir2 = normalize(lightpos2 - p);
    float fade1 = exp(-.1 * distance(p, lightpos1)); // factor de atenuación por distancia de p a las luces
    float fade2 = exp(-.07 * distance(p, lightpos2));
    float sh1 = shadow1(p); // obtención del factor sombra
    float sh2 = shadow2(p);
    vec3 n = normal(p); // obtención del normal
    float aoc = ao(p, n); // obtención del factor de oclusión ambiental
    vec3 amb = .2 * ao(p, n) * (light1color * fade1 + light2color * fade2); // la luz ambiental, multiplicada por 
        // la oclusión ambiental y los colores de las luces con el factor de fade, cuanto más lejos, menos luz
        // aquí no se aplica la sombra directa (sh) ya que se trata de simular luz que llega por rebotes indirectamente
    vec3 dif1 = max(0., dot(lightdir1, n)) * light1color * fade1 * sh1 * .8; // luz difusa, se multiplica por el factor
    vec3 dif2 = max(0., dot(lightdir2, n)) * light2color * fade2 * sh2 * .8; // de atenuación y sh que es la sombra directa
    vec3 ref1 = reflect(lightdir1, n);
    vec3 ref2 = reflect(lightdir2, n);
    vec3 spe1 = pow(max(0., dot(ref1, dir)),10.) * light1color * sh1 *fade1 * .7; // luz especular, se multiplica por lo mismo
    vec3 spe2 = pow(max(0., dot(ref2, dir)),10.) * light2color * sh2 * fade2 * .7; // que la luz difusa
    return amb + dif1 + spe1 + dif2 + spe2; // devuelve las luces combinadas
}


// función de raymarching
vec3 march(vec3 from, vec3 dir) 
{
    float maxdist = 50.;
    float totdist = 0.;
    float steps = 100.;
    float d;
    vec3 p;
    vec3 col = vec3(0.);
    float glow1 = 0., glow2 = 0.; // variables para la obtención del brillo "glow" alrededor de las luces
    for (float i=0.; i<steps; i++)
    {
        p = from + totdist * dir;
        d = de(p);
        if (d < det || totdist > maxdist) break;
        totdist += d;
        glow1 = max(glow1, 1. - light1); // capturamos cuando el rayo pasa cerca de las luces, obteniendo un valor
        glow2 = max(glow2, 1. - light2); // entre 0 y 1 según la distancia a la que pasó
    }
    if (d < det) 
    {
        col = shade(p, dir);
    }
    col += pow(glow1, 5.) * light1color; // sumamos el brillo glow de las luces, elevando a un exponente
    col += pow(glow2, 5.) * light2color; // para definir el tamaño del glow
                                             // este glow genera "banding", sobre todo si no está exponenciado
    return col;
}


void main(void)
{
    vec2 uv = (gl_FragCoord.xy - resolution / 2.) / resolution.y;
    vec3 from = vec3(0., 3., -30. + sin(time * .3) * 15.); // origen con movimiento de la cámara
    vec3 dir = normalize(vec3(uv, .7));
    lightpos1 = vec3(sin(time) * 7., 5.+sin(time*2.), cos(time) * 5.); // posiciones de las luces
    lightpos2 = vec3(-sin(time * .5) * 15., 17.+cos(time)* 3., cos(time * .5) * 15.);
    vec3 col = march(from, dir);
    fragColor = vec4(col, 1.);
}


#version 150

// EJEMPLO DE TUNEL CON SEGUIMIENTO DE CAMARA
// no está comentada la aplicación de las luces y otras cosas ya que es similar a los ejemplos anteriores

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;
uniform vec3 spectrum;


out vec4 fragColor;

float det = .001;
vec3 lightpos1, lightpos2;
float light1, light2;
vec3 light1color = vec3(2.,1.,0.);
vec3 light2color = vec3(0.,1.,2.);

mat2 rot(float a) 
{
    float s=sin(a), c=cos(a);
    return mat2(c,s,-s,c);
}

// copiar las coordenadas radialmente, cant = cantidad de veces, offset = distancia desde el centro (aquí definiría el radio del túnel)
void radialCopy(inout vec2 p, float cant, float offset) 
{
    float d = 3.1416 / cant * 2.;
    float at = atan(p.y, p.x);
    float a = mod(at, d) - d *.5;
    p = vec2(cos(a), sin(a)) * length(p) - vec2(offset,0.);
}

// distancia a una caja
float sdRoundBox( vec3 p, vec3 b, float r )
{
  vec3 q = abs(p) - b;
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0) - r;
}

// función path, devuelve una posición que define el "camino" que sigue el túnel y la cámara para una posición t
// t = time para la cámara, coordenada z para la obtención de distancia (ver más abajo)
vec3 path(float t) 
{
    vec3 p = vec3(sin(t * .1), cos(t * .2), t);
    p.xy += cos(t*.1) * 5.;
    return p;
}


// función de estimación de distancia
float de(vec3 p) 
{
    light1 = length(p - lightpos1) - .1;
    light2 = length(p - lightpos2) - .1;
    p.xy -= path(p.z).xy; // desplazar el tunel en xy según el camino que recorre la cámara y la posición en z (profundidad)
    vec3 p2 = p;
    // obtengo el id de cada aro del túnel antes de usar fract más abajo para repetir la coordenada z
    float id = floor(p2.z);
    p2.xy *= rot(sin(id + time)); // roto en xy según sin de time + el id que genera el desfasaje
    radialCopy(p2.xy, 15., 2.); // copiar radialmente
    p2.z = fract(p2.z) - .5; // copiar en z
    float ring1 = sdRoundBox(p2, vec3(.1,.35,.3), .1); // un sólo cálculo de la distancia a la caja genera todo el tunel
    float d = min(ring1, min(light1, light2)); // combinación del túnel con la distancia a las luces
    return d;
}

vec3 normal(vec3 p) 
{
    vec2 d = vec2(0., det);
    return normalize(vec3(de(p+d.yxx), de(p+d.xyx), de(p+d.xxy)) - de(p));
}

vec3 shade(vec3 p, vec3 dir)
{
    if (light1<det) return light1color;
    if (light2<det) return light2color;
    vec3 lightdir1 = normalize(lightpos1 - p);
    vec3 lightdir2 = normalize(lightpos2 - p);
    float fade1 = exp(-.2 * distance(p, lightpos1));
    float fade2 = exp(-.2 * distance(p, lightpos2));
    vec3 n = normal(p);
    vec3 dif1 = max(0., dot(lightdir1, n)) * light1color * fade1 * .7;
    vec3 dif2 = max(0., dot(lightdir2, n)) * light2color * fade2 * .7;
    vec3 ref1 = reflect(lightdir1, n);
    vec3 ref2 = reflect(lightdir2, n);
    vec3 spe1 = pow(max(0., dot(ref1, dir)),10.) * light1color * fade1;
    vec3 spe2 = pow(max(0., dot(ref2, dir)),10.) * light2color * fade2;
    return dif1 + spe1 + dif2 + spe2;
}


vec3 march(vec3 from, vec3 dir) 
{
    float maxdist = 100.;
    float totdist = 0.;
    float steps = 200.;
    float d;
    vec3 p;
    vec3 col = vec3(0.);
    float glow1 = 0., glow2 = 0.;
    for (float i=0.; i<steps; i++)
    {
        p = from + totdist * dir;
        d = de(p);
        if (d < det || totdist > maxdist) break;
        totdist += d;
        glow1 = max(glow1, 1. - light1);
        glow2 = max(glow2, 1. - light2);
    }
    if (d < det) 
    {
        col = shade(p, dir);
    }
    col += pow(glow1, 5.) * light1color;
    col += pow(glow2, 5.) * light2color;
    return col;
}

// devuelve un mat3 para alinear un vector con el vector dir, especificando la dirección que se tomaría como "arriba"
mat3 lookat(vec3 dir, vec3 up) 
{
    dir = normalize(dir);
    vec3 rt = normalize(cross(dir, up));
    return mat3(rt, cross(rt, dir), dir);
}


void main(void)
{
    vec2 uv = (gl_FragCoord.xy - resolution / 2.) / resolution.y;
    float t = time * 4.; 
    vec3 from = path(t); // posición de la camara según t
    vec3 adv = path(t + 1.); // posición de la cámara en t + 1 (un poco después), para obtener vector donde apunta
    vec3 look = normalize(adv - from); // vector hacia donde mira la cámara
    vec3 dir = normalize(vec3(uv, 1.)); // obtencion de la dir del rayo
    dir = lookat(look, vec3(0., 1., 0.)) * dir; // alineación de la dir con el vector hacia donde apunta la cámara
    // las luces siguen también el camino, aunque se le agregan otros movimiento
    lightpos1 = path(t + 5. * (1. + sin(time / 2.))) + vec3(sin(time) * 1., cos(time) * 1., 0.); 
    lightpos2 = path(t + 15.) + vec3(-sin(time) * 1., cos(time) * 1., 0.);
     vec3 col = march(from, dir);
    fragColor = vec4(col, 1.);
}

#version 120

uniform float time;
uniform vec2 resolution;
uniform vec2 mouse;

float det=.001; // umbral de choque
vec3 colfinal, colhead, coleyes, colarms, colvirus; // variables de color


// matriz de rotación
mat2 rot(float a)
{
    float s=sin(a),c=cos(a);
    return mat2(c,s,-s,c);
}

// smooth minimum
float smin( float a, float b, float k )
{
    float h = clamp( 0.5+0.5*(b-a)/k, 0.0, 1.0 );
    return mix( b, a, h ) - k*h*(1.0-h);
}

// smooth substraction - resta una forma a otra suavizando los bordes (acá se ve en los ojos)
float ssub( float a, float b, float k )
{
    float h = clamp( 0.5+0.5*(b+a)/k, 0.0, 1.0 );
    return mix( -b, a, h ) - k*h*(1.0-h);
}

// distancia a una "cápsula", es un cilindro con los extremos redondeados
// a y b son las posiciones de los extremos, r el grosor
float sdCapsule( vec3 p, vec3 a, vec3 b, float r )
{
  vec3 pa = p - a, ba = b - a;
  float h = clamp( dot(pa,ba)/dot(ba,ba), 0.0, 1.0 );
  return length( pa - ba*h ) - r;
}

// distancia a los brazos / patas
float arms(vec3 p)
{
    float s=sign(p.x); // guardo el signo (-1. o 1.) para saber de que lado del eje x estoy luego del abs
    p.x=abs(p.x); // espejo en x, con esto solo hace falta calcular un brazo
    p.z-=1.; // me muevo en z hacia atras
    p.yz*=rot(sin(time*5.+s*3.1416*.5)*.5-.4); // rotacion que anima los brazos, s aparece multiplicando para desfasar la simetria del movimiento
    // combinacion de los segmentos con smin
    float d=sdCapsule(p,vec3(3.,1.,0.),vec3(4.,-1.,0.),.5); 
    d=smin(d,sdCapsule(p,vec3(4.,-1.,0.),vec3(4.,-2.5,-.7),.4),.2);
    d=smin(d,sdCapsule(p,vec3(4.,-2.7,-1.),vec3(2.5,-3.5,-2.5),.2),.2);
    d=smin(d,sdCapsule(p,vec3(4.,-2.7,-1.),vec3(1.5,-3.5,-2.),.2),.1);
    d=smin(d,sdCapsule(p,vec3(4.,-2.7,-1.),vec3(1.5,-3.5,-1.),.2),.1);
    colarms=vec3(.5,.2,.0)*(1.+sin(p.y*20.)*smoothstep(-2.,-1.5,p.y)); // defino el color de los brazos, dibujo unas lineas con sin
    return d;
}

// distancia a los ojos
float eyes(vec3 p)
{
    p.y-=.7; // posicionado en p.y
    p.z+=1.8; // posicionado en p.z
    float s=sign(p.x); // guardo el signo del eje p.x 
    p.x=abs(p.x)-1.5; // expejo en x, con esto solo hace falta calcular solo un ojo
    p.xz*=rot(sin(time)*s*.5); // giro los ojos con un seno, pero multiplico por el signo guardado de lo contrario el ojo espejo giraria de manera inversa al otro
    coleyes=mix(vec3(1.),vec3(.2,.5,1.)-.1*sin(atan(p.x,p.y)*20.),smoothstep(.55,.4,length(p.xy)))*(1.-smoothstep(.3,.2,length(p.xy))); // dibujo iris y pupilas
    float eye=length(p)-.9; //distancia a una esfera
    return eye;
}

// distancia a la cabeza
float head(vec3 p)
{
    vec3 p2=p; // guardo la posicion inicial
    p.z*=1.5; // achatamiento en el eje z
    p*=1.-smoothstep(-1.,2.,p.y)*.2; // deformacion (escalado) que varia con el eje y usando smoothstep
    float hea=length(p)-3.; // distancia a una esfera, pero con las coordenadas alteradas previamente
    p=p2; // recupero p inicial
    p.y+=.5; // posicionado
    p.z*=1.2; // achatado en p.z
    p.z+=.3; // posicionado
    p.x*=1.+smoothstep(-.5,1.,p.y)*.5; // achatamiento en p.x en base a un smoothstep de p.y
    float bar=max(p.z,length(p)-2.4-length(sin(p*30.))*.01); // distancia al barbijo que es una esfera deformada que se asoma, 
                                    //(con interseccion del plano z para que no aparezca atras del cuerpo también)
    float d=min(bar,hea); // combinar barbijo y cabeza
    if (d==bar) colhead=vec3(0.,.2,.5); // si es barbijo, setear el color en azul
    else colhead=vec3(1.,.7,.3); // sino color piel
    p=p2; // recupero p inicial
    p.y-=.7; // posicionado
    p.z+=2.; // posicionado
    p.x=abs(p.x)-1.5; // espejo en x
    float eye=length(p)-1.; // distancia a un ojo
    d=ssub(d,eye,.1); // substraigo el ojo a la forma en d, con funcion para suavizar los bordes
    float x=p.x; // guardo x antes del abs
    p.x=abs(p.x)-1.; // espejo en x
    colhead-=smoothstep(.15,.1,abs(p.y-1.-cos(x*2.)*.5)-cos(x*2.)*.15); // dibujo de las cejas restando al color
    return d*.5; // debido a las deformaciones achico la distancia resultante
}

// distancia a un virus
float virus(vec3 p)
{
    float clear=abs(p.x)-4.; // distancia a un piso vertical en x de 4 de grosor, para "limpiar" de virus el camino
    p.x+=sin(p.z+time); // ondulacion de los virus
    p=mod(p,4.)-2.; // repeticion de dominio
    // modelado del virus
    float z=length((fract(p*5.)-.5)*2.); 
    float vir=length(p)-.4-pow(4.*z*(1.-z),2.)*.008;
    // color del virus segun la distancia calculada
    colvirus=mix(vec3(.7),vec3(1.,0.,0.),smoothstep(.001,.0,vir));
    // restar a la escena lo calculado previamente para quitar los virus centrales
    vir=max(vir,-clear);
    return vir*.5;
}

// funcion de distancia general
float de(vec3 p)
{
    //distancias
    float he=head(p); // cabeza
    float ey=eyes(p); // ojos
    float ar=arms(p); // brazos/patas
    float sh=length(p)-4.5; // fake shadow
    p.z-=time*5.+sin(time*10.+.5)*.11; // para el movimiento de avance en realidad mueve los virus y el suelo para atras. 
                                        // (el seno es para una pequeña aceleracion/desaceleracion al caminar
    float vi=virus(p); // distancia al los virus
    float gr=p.y+4.3; // distancia al piso
    float d=min(he,ey); // combinacion de los objetos
    d=min(d,ar); 
    d=min(d,gr);
    d=min(d,vi);
    // compara para saber el objeto mas cercano y setear el color final
    if (d==he) colfinal=colhead;
    if (d==ey) colfinal=coleyes;
    if (d==ar) colfinal=colarms;
    if (d==gr) colfinal=length(sin(p.xz*4))*vec3(.3,.7,0.)*(.4+.6*smoothstep(.5,3.,length(sh))); // para el suelo define acá directamente el color con una textura y se aplica una sombra fake
    if (d==vi) colfinal=colvirus;
    return d;
}

vec3 normal(vec3 p)
{
    vec2 e=vec2(0.,det);
    return normalize(vec3(de(p+e.yxx),de(p+e.xyx),de(p+e.xxy))-de(p));
}

vec3 shade(vec3 p, vec3 dir)
{
    vec3 col=colfinal;
    vec3 ldir=normalize(vec3(2.,1.,-1.));
    vec3 n=normal(p);
    float amb=max(0.,dot(-dir,n))*.1;
    float dif=max(0.,dot(ldir,n))*.5;
    vec3 ref=reflect(ldir,n);
    float spe=pow(max(0.,dot(dir,ref)),20.)*.5;
    return (amb+dif)*col+spe;
}

vec3 march(vec3 from, vec3 dir)
{ 
    vec3 p, col=vec3(0.);
    float d, td=0., maxdist=100.;
    for (int i=0; i<200; i++)
    { 
        p=from+dir*td;
        p.xz*=rot(td*.02); // pequeño truco de hacer rotar el rayo para una perspectiva curva media loca
        d=de(p);
        if (d<det || td>maxdist) break;
        td+=d;
    }
    if (d<det) 
    {
        col=shade(p, dir);
    }
    else 
    {
        td=maxdist;
    }
    return col*exp(-.0005*td*td)*1.5;
}


void main(void)
{
    vec2 uv = gl_FragCoord.xy/resolution-.5;
    uv.x*=resolution.x/resolution.y;
    vec3 from=vec3(0.,0.,-15.);
    vec3 dir=normalize(vec3(uv,1.));
    float r=sin(time*.5)*.5;
    from.xz*=rot(r);
    dir.xz*=rot(r);
    vec3 col=march(from, dir);
    gl_FragColor = vec4(col,1.);
}

