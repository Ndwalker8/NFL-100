import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';

export default function AuthModal({ onClose }) {
  const [mode, setMode] = useState('signIn'); // 'signIn' or 'signUp'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');

  const signIn = async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
    else onClose();
  };

  const signUp = async () => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return alert(error.message);
    const uid = data.user?.id;
    if (uid) {
      const { error: e2 } = await supabase.from('profiles').insert({ id: uid, username });
      if (e2) alert(e2.message);
    }
    onClose();
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    onClose();
  };

  return (
    <View style={S.container}>
      <Text style={S.title}>
        {mode === 'signUp' ? 'Create Account' : 'Sign In'}
      </Text>

      {mode === 'signUp' && (
        <TextInput
          style={S.input}
          placeholder="Username"
          autoCapitalize="none"
          value={username}
          onChangeText={setUsername}
        />
      )}
      <TextInput
        style={S.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={S.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <TouchableOpacity
        onPress={mode === 'signUp' ? signUp : signIn}
        style={S.primaryButton}
      >
        <Text style={S.primaryText}>
          {mode === 'signUp' ? 'Sign Up' : 'Sign In'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => setMode(mode === 'signUp' ? 'signIn' : 'signUp')}
      >
        <Text style={S.linkText}>
          {mode === 'signUp'
            ? 'Already have an account? Sign in'
            : 'New here? Create an account'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={signOut} style={S.mutedButton}>
        <Text>Sign Out</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={onClose}>
        <Text style={S.linkText}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: 'white',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 10,
  },
  primaryButton: {
    backgroundColor: '#0ea5e9',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryText: {
    color: 'white',
    fontWeight: '800',
  },
  linkText: {
    color: '#0ea5e9',
    textAlign: 'center',
    marginTop: 6,
  },
  mutedButton: {
    alignSelf: 'center',
    marginTop: 8,
    padding: 6,
  },
});
