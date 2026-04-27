SKILLS de p5js. 

Si estas haciendo un sketch generativo que utilice p5js podes seguir estos consejos :


1)
EFECTO DE SOMBRA : 
Si el usuario te pide "hacele un efecto de sombra" podes hacer algo muy sencillo que es dibujar la misma figura con un offset de 5 a 10 . 
Por ejemplo : 

Si tu dibujo es : 

fill(255,0,0); 
ellipse(mouseX,mouseY,30,30);

La sombra sería 
let offset = 10; 
fill(255); 
ellipse(mouseX-offset,mouseY-offset,30,30);
fill(0); 
ellipse(mouseX+offset,mouseY+offset,30,30);
fill(255,0,0); 
ellipse(mouseX,mouseY,30,30);

2)Si piden hacer un sistema de particulas o un programa complejo, siempre te conviene separar las cosas en distintos archivos.Un sketch basico de p5js con particulas tendria : 

index.html
style.css
script.js (Donde corre el sketch de p5js principal) 
particle.js (Donde esta la clase de la particula y la clase que maneja las particulas (clase particula y clase sistema de particulas) . 

3)Siempre es mejor utilizar Clases y objetos. 


