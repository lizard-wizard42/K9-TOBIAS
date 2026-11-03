#pragma once
#include <cstdint>
#include <string>
class String : public std::string {
 public: using std::string::string;
 String(int n):std::string(std::to_string(n)){}
 bool startsWith(const char* p) const { return rfind(p,0)==0; }
};
inline uint32_t clockMs=0;
inline int lastDuty=0;
inline uint32_t millis(){return clockMs;}
inline void ledcWrite(int,int duty){lastDuty=duty;}
inline void ledcSetup(int,int,int){}
inline void ledcAttachPin(int,int){}
