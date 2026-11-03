#pragma once
#include <map>
#include <string>
class Preferences {
 std::map<std::string,int> values;
 public:
 uint8_t getUChar(const char* k,uint8_t fallback){return values.count(k)?values[k]:fallback;}
 void putUChar(const char* k,uint8_t v){values[k]=v;}
 void begin(const char*,bool){}
 bool getBool(const char* k,bool fallback){return values.count(k)?values[k]:fallback;}
 void putBool(const char* k,bool v){values[k]=v;}
};
