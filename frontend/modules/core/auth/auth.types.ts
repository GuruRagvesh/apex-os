export interface Role {
  id:    string;
  name:  string;
  level: number;
}

export interface Department {
  id:    string;
  name:  string;
  color: string;
}

export interface User {
  id:          string;
  email:       string;
  name:        string;
  avatar?:     string;
  isActive:    boolean;
  role:        Role;
  department?: Department;
  createdAt:   string;
}

export interface AuthResponse {
  access_token: string;
  user:         User;
}
