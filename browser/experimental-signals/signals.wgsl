// Shared reconstruction ABI. Colors are three independent lighting signals.
struct Pixel { color:vec4f,position:vec4f,normal:vec4f,moments:vec4f,secondary:vec4f,secondaryNormal:vec4f }
struct Signals {
 diffuse:vec4f,specular:vec4f,transmission:vec4f,
 position:vec4f,normal:vec4f,
 diffuseMoments:vec4f,specularMoments:vec4f,transmissionMoments:vec4f,
 secondary:vec4f,secondaryNormal:vec4f
}
fn readSignal(s:Signals,channel:u32)->Pixel {
 var c=s.diffuse;var m=s.diffuseMoments;
 if(channel==1u){c=s.specular;m=s.specularMoments;}
 if(channel==2u){c=s.transmission;m=s.transmissionMoments;}
 return Pixel(c,s.position,s.normal,m,s.secondary,s.secondaryNormal);
}
