import { Injectable } from '@angular/core';
import { HttpBackend, HttpClient } from '@angular/common/http';



@Injectable({ providedIn: 'root' })
export class ChatgptService {

  private raw: HttpClient;
  constructor(backend: HttpBackend) {
    // bypass interceptors so nothing tampers with auth headers
    this.raw = new HttpClient(backend);
  }

}
