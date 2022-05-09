import store from "./src/store/store";
import Login from "./src/view/login";
import { Provider } from "react-redux";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import Register from "./src/view/register";
import React from "react";
import FlashMessage from "react-native-flash-message";
import Main from "./src/view/main";
import Categories from "./src/view/categories";
import Game from "./src/view/game";
import Result from "./src/view/result";
import { APP_NAME } from "./src/pre-start/constants";
import Button from "./src/component/atom/button";
import Settings, { SettingsButton } from "./src/view/settings";

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <Provider store={store}>
      <NavigationContainer>
        <Stack.Navigator initialRouteName="Login">
          <Stack.Screen
            component={Login}
            name="Login"
            options={{ title: APP_NAME }}
          />
          <Stack.Screen
            component={Register}
            name="Register"
            options={{ title: APP_NAME }}
          />
          <Stack.Screen
            component={Main}
            name="Main"
            options={{
              title: APP_NAME,
              headerRight: SettingsButton,
            }}
          />
          <Stack.Screen
            component={Categories}
            name="Categories"
          />
          <Stack.Screen component={Game} name="Game" />
          <Stack.Screen component={Result} name="Result" />
          <Stack.Screen component={Settings} name="Settings" />
        </Stack.Navigator>
      </NavigationContainer>
      <FlashMessage position="bottom" />
    </Provider>
  );
}
