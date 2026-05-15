export interface UserPayload {
  id:           string;
  email:        string;
  name:         string;
  avatar?:      string;
  isActive:     boolean;
  role:         { id: string; name: string; level: number };
  department?:  { id: string; name: string; color: string };
}
