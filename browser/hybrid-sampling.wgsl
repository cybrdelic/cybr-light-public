fn rasterJitterAt(frame:u32)->vec2f{
 var a=frame+1u;var b=a;var x=0.;var y=0.;var wx=.5;var wy=1./3.;
 loop{if(a==0u){break;}x+=f32(a%2u)*wx;wx*=.5;a/=2u;}
 loop{if(b==0u){break;}y+=f32(b%3u)*wy;wy/=3.;b/=3u;}
 return vec2f(x,y)-.5;
}
