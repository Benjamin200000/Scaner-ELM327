/* Test-only J2534 ABI: never load this library against a vehicle. */
#include <stdint.h>
#include <string.h>
#include <windows.h>
#define API __declspec(dllexport) uint32_t __stdcall
#if defined(_M_IX86)
#pragma comment(linker,"/EXPORT:PassThruOpen=_PassThruOpen@8")
#pragma comment(linker,"/EXPORT:PassThruClose=_PassThruClose@4")
#pragma comment(linker,"/EXPORT:PassThruDisconnect=_PassThruDisconnect@4")
#pragma comment(linker,"/EXPORT:PassThruReadMsgs=_PassThruReadMsgs@16")
#pragma comment(linker,"/EXPORT:PassThruWriteMsgs=_PassThruWriteMsgs@16")
#pragma comment(linker,"/EXPORT:PassThruStartMsgFilter=_PassThruStartMsgFilter@24")
#pragma comment(linker,"/EXPORT:PassThruStopMsgFilter=_PassThruStopMsgFilter@8")
#pragma comment(linker,"/EXPORT:PassThruIoctl=_PassThruIoctl@16")
#pragma comment(linker,"/EXPORT:PassThruGetLastError=_PassThruGetLastError@4")
#endif
/* PassThruConnect has five parameters (20 bytes), including the output pointer. */
#if defined(_M_IX86)
#pragma comment(linker,"/EXPORT:PassThruConnect=_PassThruConnect@20")
#endif
typedef struct { uint32_t protocol,status,flags,timestamp,size,extra; uint8_t data[4128]; } Message;
typedef char size_check[sizeof(Message)==4152?1:-1];
static Message response;
static int ready=0,phase=0;
static uint8_t service;
API PassThruOpen(void *name,uint32_t *id){(void)name;*id=123;return 0;}
API PassThruClose(uint32_t id){return id==123?0:0x1A;}
API PassThruConnect(uint32_t id,uint32_t protocol,uint32_t flags,uint32_t baud,uint32_t *channel)
{if(id!=123||protocol!=6||flags!=0||baud!=500000)return 3;*channel=456;return 0;}
API PassThruDisconnect(uint32_t channel){return channel==456?0:0x02;}
API PassThruStartMsgFilter(uint32_t channel,uint32_t type,Message *mask,Message *pattern,Message *flow,uint32_t *id)
{
 if(channel!=456||type!=3||mask->protocol!=6||mask->size!=4||pattern->size!=4||flow->size!=4)return 4;
 if(pattern->data[2]!=7||pattern->data[3]!=0xE8||flow->data[2]!=7||flow->data[3]!=0xE0)return 4;
 *id=789;return 0;
}
API PassThruStopMsgFilter(uint32_t channel,uint32_t id){return channel==456&&id==789?0:4;}
API PassThruIoctl(uint32_t channel,uint32_t id,void *in,void *out)
{(void)in;(void)out;if(channel!=456)return 2;if(id==8){ready=0;return 0;}return 1;}
API PassThruGetLastError(char *message){strcpy_s(message,80,"fake J2534 ABI rejected a parameter");return 0;}
API PassThruWriteMsgs(uint32_t channel,Message *message,uint32_t *count,uint32_t timeout)
{
 uint8_t *request=message->data+4,*payload=response.data+4;
 uint32_t size=0,i,address,length;
 (void)timeout;
 if(channel!=456||*count!=1||message->protocol!=6||message->size<5||message->size>4128)return 4;
 if(message->data[2]!=7||message->data[3]!=0xE0)return 4;
 memset(&response,0,sizeof(response));response.protocol=6;response.data[2]=7;response.data[3]=0xE8;
 service=request[0];
 if(service==1){payload[0]=0x41;payload[1]=request[1];if(request[1]==0x0C){payload[2]=0x0D;payload[3]=0x48;size=4;}else{payload[2]=0xBE;payload[3]=0x3F;payload[4]=0xA8;payload[5]=0x12;size=6;}}
 else if(service==0x10){payload[0]=0x50;payload[1]=request[1];size=2;}
 else if(service==0x23)
 {
  if(message->size!=12||request[1]!=0x24)return 4;
  address=((uint32_t)request[2]<<24)|((uint32_t)request[3]<<16)|((uint32_t)request[4]<<8)|request[5];
  length=((uint32_t)request[6]<<8)|request[7];if(length>64)return 4;
  payload[0]=0x63;for(i=0;i<length;i++)payload[i+1]=(uint8_t)((address+i)*17);size=length+1;
 }
 else if(service==3){uint8_t codes[]={0x43,2,1,0x71,3,0};memcpy(payload,codes,sizeof(codes));size=sizeof(codes);}
 else {payload[0]=0x7F;payload[1]=service;payload[2]=0x11;size=3;}
 response.size=size+4;ready=1;phase=0;*count=1;return 0;
}
API PassThruReadMsgs(uint32_t channel,Message *message,uint32_t *count,uint32_t timeout)
{
 (void)timeout;if(channel!=456||*count!=1)return 4;
 if(!ready){*count=0;return 0x10;}
 *message=response;*count=1;
 if(phase==0){message->status=8;phase++;return 0;}
 if(phase==1){message->status=2;phase++;return 0;}
 if(phase==2&&service==0x23){message->data[4]=0x7F;message->data[5]=0x23;message->data[6]=0x78;message->size=7;phase++;return 0;}
 ready=0;return 0;
}
